/**
 * SmartNotes - Persistent OCR Job Queue & Background Worker (services/ocrQueue.js)
 * Manages durable, restart-safe, multi-page PDF OCR processing using SQLite.
 *
 * Key Architectural Features:
 *  - Automatically processes complete documents page-by-page in small batches (3 pages).
 *  - Detects pages with selectable text vs pages requiring OCR.
 *  - Persists progress and intermediate page text in SQLite (file_pages & ocr_jobs).
 *  - Concurrency limited to 1 job at a time to stay safely within Render's 512MB RAM.
 *  - Resumes interrupted jobs automatically on server restart without losing completed pages.
 *  - Provides safe page-level retry without reprocessing already-successful pages.
 *  - Prevents duplicate notes and duplicate jobs on request retries.
 */

const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const ocrService = require('./ocr');
const s3Service = require('./s3');
const { PDFParse } = require('pdf-parse');

// In-memory buffer cache for active jobs to avoid unnecessary re-reads
const jobBufferMap = new Map();

// Processing mutex
let isProcessing = false;

/**
 * Sanitizes text to remove sensitive secrets or tokens from log messages
 */
function sanitizeLog(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/(key=|token=|secret=|bearer\s+)[a-z0-9_\-\.]{10,}/gi, '$1[REDACTED]');
}

/**
 * Enqueues a new OCR processing job or updates an existing job
 * @param {Object} params - { fileId, userId, originalName, subject, pdfBuffer }
 * @returns {Object} Job record
 */
function enqueueJob({ fileId, userId, originalName, subject, pdfBuffer }) {
  if (pdfBuffer && Buffer.isBuffer(pdfBuffer)) {
    jobBufferMap.set(fileId, pdfBuffer);
  }

  // Ensure ocr_jobs row exists
  const existingJob = db.prepare('SELECT id, status FROM ocr_jobs WHERE file_id = ?').get(fileId);
  let jobId;

  if (existingJob) {
    db.prepare(`
      UPDATE ocr_jobs
      SET status = 'queued',
          status_message = 'Job queued for processing...',
          updated_at = CURRENT_TIMESTAMP
      WHERE file_id = ?
    `).run(fileId);
    jobId = existingJob.id;
  } else {
    const insert = db.prepare(`
      INSERT INTO ocr_jobs (file_id, user_id, status, status_message, batch_size, failed_pages, retry_count)
      VALUES (?, ?, 'queued', 'Job queued for processing...', 3, '[]', 0)
    `).run(fileId, userId);
    jobId = insert.lastInsertRowid;
  }

  // Update file record status
  db.prepare(`
    UPDATE files
    SET status = 'processing',
        status_message = 'Job queued. Initializing text extraction pipeline...'
    WHERE id = ?
  `).run(fileId);

  // Trigger worker loop asynchronously
  setImmediate(() => {
    scheduleNext();
  });

  return {
    jobId,
    fileId,
    status: 'queued',
    message: 'Job queued successfully.'
  };
}

/**
 * Schedules processing if worker is currently idle
 */
function scheduleNext() {
  if (isProcessing) return;
  processQueue().catch(err => {
    console.error('[OCR Queue] Worker loop error:', sanitizeLog(err.message));
  });
}

/**
 * Main worker loop: processes jobs sequentially from SQLite
 */
async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (true) {
      // Fetch oldest queued job
      const job = db.prepare(`
        SELECT j.*, f.original_filename, f.subject, f.s3_key
        FROM ocr_jobs j
        JOIN files f ON j.file_id = f.id
        WHERE j.status = 'queued'
        ORDER BY j.created_at ASC
        LIMIT 1
      `).get();

      if (!job) break;

      await executeJob(job);

      // Yield briefly to ensure Express event loop handles incoming HTTP traffic
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Executes a single OCR job with page-level tracking and batching
 * @param {Object} job - ocr_jobs row
 */
async function executeJob(job) {
  const fileId = job.file_id;
  const userId = job.user_id;
  const filename = job.original_filename || 'document.pdf';
  const subject = job.subject || 'General';

  console.log(`[OCR Queue] Starting processing for "${filename}" (fileId=${fileId}, jobId=${job.id})`);

  // Update job and file to 'processing'
  db.prepare(`
    UPDATE ocr_jobs
    SET status = 'processing',
        status_message = 'Analyzing document structure and text layer...',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(job.id);

  db.prepare(`
    UPDATE files
    SET status = 'processing',
        status_message = 'Analyzing document structure and text layer...'
    WHERE id = ?
  `).run(fileId);

  try {
    // 1. Obtain PDF buffer
    let pdfBuffer = jobBufferMap.get(fileId);
    if (!pdfBuffer) {
      const fileRow = db.prepare('SELECT file_data, s3_key FROM files WHERE id = ?').get(fileId);
      if (fileRow && fileRow.file_data) {
        pdfBuffer = fileRow.file_data;
      } else if (fileRow && fileRow.s3_key) {
        const retrieved = await s3Service.getFileFromStorage(fileRow.s3_key, fileRow);
        if (retrieved && retrieved.stream) {
          pdfBuffer = await streamToBuffer(retrieved.stream);
        }
      }
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Unable to retrieve PDF file data from database or storage.');
    }

    // 2. Inspect pages and initialize file_pages table if not already populated
    const existingPages = db.prepare('SELECT COUNT(*) as count FROM file_pages WHERE file_id = ?').get(fileId);

    if (existingPages.count === 0) {
      console.log(`[OCR Queue] Inspecting pages for "${filename}"...`);
      let parser = null;
      let totalPages = 1;
      let parsedPages = [];

      try {
        parser = new PDFParse({ data: pdfBuffer });
        const textResult = await parser.getText();
        if (textResult) {
          totalPages = textResult.total || (textResult.pages ? textResult.pages.length : 1);
          parsedPages = textResult.pages || [];
        }
      } catch (err) {
        console.warn(`[OCR Queue] Direct text scan warning for "${filename}":`, err.message);
        totalPages = await ocrService.getPdfPageCount(null, pdfBuffer);
      } finally {
        if (parser && typeof parser.destroy === 'function') {
          try { await parser.destroy(); } catch (_) {}
        }
      }

      // Record total pages in ocr_jobs
      db.prepare('UPDATE ocr_jobs SET total_pages = ? WHERE id = ?').run(totalPages, job.id);

      // Insert entries into file_pages
      const insertPage = db.prepare(`
        INSERT OR IGNORE INTO file_pages (file_id, page_number, text_content, is_ocr, status)
        VALUES (?, ?, ?, ?, ?)
      `);

      const initTx = db.transaction(() => {
        for (let p = 1; p <= totalPages; p++) {
          const pageData = parsedPages.find(item => item.num === p);
          let pageText = (pageData && pageData.text) ? pageData.text.trim() : '';

          // Clean markers
          pageText = pageText
            .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const words = pageText.split(/\s+/).filter(w => w.length > 1);

          // If page has selectable text (5+ words), mark as completed directly without OCR
          if (words.length >= 5) {
            insertPage.run(fileId, p, pageText, 0, 'completed');
          } else {
            // Needs OCR
            insertPage.run(fileId, p, null, 1, 'pending');
          }
        }
      });
      initTx();
    }

    // 3. Find all pages that still need OCR
    const pendingPages = db.prepare(`
      SELECT page_number FROM file_pages
      WHERE file_id = ? AND status = 'pending'
      ORDER BY page_number ASC
    `).all(fileId).map(r => r.page_number);

    const totalDocPages = db.prepare('SELECT total_pages FROM ocr_jobs WHERE id = ?').get(job.id)?.total_pages ||
      db.prepare('SELECT COUNT(*) as count FROM file_pages WHERE file_id = ?').get(fileId).count;

    console.log(`[OCR Queue] "${filename}": ${totalDocPages} total pages, ${pendingPages.length} pages requiring OCR.`);

    // 4. Process pending OCR pages in bounded sequential batches
    if (pendingPages.length > 0) {
      const batchSize = job.batch_size || ocrService.OCR_CONFIG.batchSize || 3;
      const batches = [];
      for (let i = 0; i < pendingPages.length; i += batchSize) {
        batches.push(pendingPages.slice(i, i + batchSize));
      }

      for (let bIndex = 0; bIndex < batches.length; bIndex++) {
        const batch = batches[bIndex];
        const startPage = batch[0];
        const endPage = batch[batch.length - 1];

        const progressMsg = `Processing pages ${startPage}–${endPage} of ${totalDocPages}...`;
        console.log(`[OCR Queue] ${progressMsg}`);

        db.prepare(`
          UPDATE ocr_jobs
          SET status_message = ?, current_page = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(progressMsg, startPage, job.id);

        db.prepare(`
          UPDATE files
          SET status_message = ?
          WHERE id = ?
        `).run(progressMsg, fileId);

        // Process this batch of pages
        const batchResults = await ocrService.processBatch(pdfBuffer, batch, {
          filename: filename
        });

        // Update database with each page's result
        const updatePage = db.prepare(`
          UPDATE file_pages
          SET text_content = ?,
              status = ?,
              error_message = ?,
              is_ocr = 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE file_id = ? AND page_number = ?
        `);

        for (const res of batchResults) {
          if (res.success && res.text) {
            updatePage.run(res.text, 'completed', null, fileId, res.pageNum);
          } else {
            console.warn(`[OCR Queue] Page ${res.pageNum} failed for fileId=${fileId}:`, res.error);
            updatePage.run(null, 'failed', res.error || 'OCR recognition failed on page', fileId, res.pageNum);
          }
        }

        // Update processed count in ocr_jobs
        const processedCount = db.prepare(`
          SELECT COUNT(*) as count FROM file_pages WHERE file_id = ? AND status = 'completed'
        `).get(fileId).count;

        db.prepare('UPDATE ocr_jobs SET processed_pages = ? WHERE id = ?').run(processedCount, job.id);

        // Yield between batches
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    }

    // 5. Assemble final document and finalize note
    await finalizeDocument(fileId, userId, filename, subject, job.id);

  } catch (err) {
    console.error(`[OCR Queue] Job failed for fileId=${fileId}:`, sanitizeLog(err.message));
    const userMessage = err.message || 'OCR processing failed. Document may be unreadable or corrupt.';

    db.prepare(`
      UPDATE ocr_jobs
      SET status = 'failed', status_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(userMessage, job.id);

    db.prepare(`
      UPDATE files
      SET status = 'failed', status_message = ?
      WHERE id = ?
    `).run(userMessage, fileId);
  } finally {
    jobBufferMap.delete(fileId);
  }
}

/**
 * Assembles extracted pages in order and creates/updates the linked Note
 */
async function finalizeDocument(fileId, userId, filename, subject, jobId) {
  const allPages = db.prepare(`
    SELECT page_number, text_content, status, is_ocr
    FROM file_pages
    WHERE file_id = ?
    ORDER BY page_number ASC
  `).all(fileId);

  const completedPages = allPages.filter(p => p.status === 'completed' && p.text_content && p.text_content.trim());
  const failedPages = allPages.filter(p => p.status === 'failed').map(p => p.page_number);

  if (completedPages.length === 0) {
    throw new Error('OCR completed, but no readable text could be recognized across any page. Ensure the scan contains clear English text.');
  }

  // Combine page texts with clear page markers
  const combinedChunks = [];
  for (const page of allPages) {
    if (page.status === 'completed' && page.text_content) {
      combinedChunks.push(`--- Page ${page.page_number} ---\n${page.text_content.trim()}`);
    } else if (page.status === 'failed') {
      combinedChunks.push(`--- Page ${page.page_number} [OCR Unreadable / Failed] ---`);
    }
  }

  const fullText = combinedChunks.join('\n\n').trim();

  // Determine note topic and tags
  const ext = (filename.split('.').pop() || 'PDF').toUpperCase();
  const hadOcr = allPages.some(p => p.is_ocr === 1);
  const noteTopic = hadOcr ? `Scanned ${ext} (OCR Processed)` : `Uploaded ${ext} Document`;
  const noteTags = hadOcr ? `${ext}, OCR, Scanned Document` : `${ext}, Uploaded File`;

  const safeHtml = `<div class="uploaded-doc-content"><p>${fullText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>')}</p></div>`;

  // Create or update note in notes table (prevent duplicates)
  const existingNote = db.prepare('SELECT id FROM notes WHERE file_id = ?').get(fileId);
  let noteId;

  if (existingNote) {
    db.prepare('UPDATE notes SET content = ?, topic = ?, tags = ? WHERE id = ?')
      .run(safeHtml, noteTopic, noteTags, existingNote.id);
    noteId = existingNote.id;
  } else {
    const noteInsert = db.prepare(`
      INSERT INTO notes (user_id, file_id, title, subject, topic, tags, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      fileId,
      filename,
      subject,
      noteTopic,
      noteTags,
      safeHtml
    );
    noteId = noteInsert.lastInsertRowid;
  }

  const isPartial = failedPages.length > 0;
  const statusState = isPartial ? 'partially_failed' : 'completed';
  const finalMessage = isPartial
    ? `Completed with warnings: pages ${failedPages.join(', ')} were unreadable. You can retry failed pages.`
    : 'OCR processing completed successfully.';

  // Update ocr_jobs
  db.prepare(`
    UPDATE ocr_jobs
    SET status = ?,
        status_message = ?,
        failed_pages = ?,
        processed_pages = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(statusState, finalMessage, JSON.stringify(failedPages), completedPages.length, jobId);

  // Update files table
  db.prepare(`
    UPDATE files
    SET note_id = ?,
        extracted_text = ?,
        status = 'ready',
        status_message = ?,
        is_ocr = ?
    WHERE id = ?
  `).run(noteId, fullText, finalMessage, hadOcr ? 1 : 0, fileId);

  console.log(`[OCR Queue] Document finalized for "${filename}": fileId=${fileId}, noteId=${noteId}, pages=${completedPages.length}/${allPages.length}`);
}

/**
 * Retries only the failed pages of a document
 * @param {number} fileId
 * @param {number} userId
 */
function retryFailedPages(fileId, userId) {
  const file = db.prepare(`
    SELECT f.*, j.id as job_id
    FROM files f
    LEFT JOIN ocr_jobs j ON f.id = j.file_id
    WHERE f.id = ? AND (f.user_id = ? OR f.user_id = 1)
  `).get(fileId, userId);

  if (!file) {
    throw new Error('File not found or unauthorized.');
  }

  const failedCount = db.prepare(`
    SELECT COUNT(*) as count FROM file_pages WHERE file_id = ? AND status = 'failed'
  `).get(fileId).count;

  if (failedCount === 0) {
    return { success: false, message: 'There are no failed pages to retry for this document.' };
  }

  // Bounded retry safeguard: prevent infinite retry loops on corrupt/unreadable scans
  const MAX_PAGE_RETRY_COUNT = 3;
  if (file.job_id) {
    const jobRow = db.prepare('SELECT retry_count FROM ocr_jobs WHERE id = ?').get(file.job_id);
    if (jobRow && jobRow.retry_count >= MAX_PAGE_RETRY_COUNT) {
      return {
        success: false,
        maxRetriesReached: true,
        message: `Maximum retry limit (${MAX_PAGE_RETRY_COUNT}) reached. Some pages could not be recognized as readable English text.`
      };
    }
  }

  // Reset failed pages to pending
  db.prepare(`
    UPDATE file_pages
    SET status = 'pending', error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE file_id = ? AND status = 'failed'
  `).run(fileId);

  // Update job record
  if (file.job_id) {
    db.prepare(`
      UPDATE ocr_jobs
      SET status = 'queued',
          status_message = 'Retrying failed pages...',
          retry_count = retry_count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(file.job_id);
  } else {
    enqueueJob({
      fileId,
      userId: file.user_id,
      originalName: file.original_filename,
      subject: file.subject
    });
  }

  // Update files record
  db.prepare(`
    UPDATE files
    SET status = 'processing',
        status_message = 'Retrying OCR for failed pages...'
    WHERE id = ?
  `).run(fileId);

  scheduleNext();

  return {
    success: true,
    message: `Retrying OCR for ${failedCount} previously failed page(s).`
  };
}

/**
 * Recovers interrupted jobs on server restart
 */
function recoverInterruptedJobs() {
  try {
    const interrupted = db.prepare(`
      SELECT j.id, j.file_id, j.user_id, f.original_filename, f.subject
      FROM ocr_jobs j
      JOIN files f ON j.file_id = f.id
      WHERE j.status IN ('processing', 'queued')
    `).all();

    if (interrupted.length > 0) {
      console.log(`[OCR Recovery] Found ${interrupted.length} interrupted job(s) from previous server run. Re-queuing...`);
      for (const job of interrupted) {
        db.prepare(`
          UPDATE ocr_jobs
          SET status = 'queued',
              status_message = 'Resuming interrupted processing after server restart...',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(job.id);

        db.prepare(`
          UPDATE files
          SET status = 'processing',
              status_message = 'Resuming OCR processing after server restart...'
          WHERE id = ?
        `).run(job.file_id);
      }
      scheduleNext();
    }

    // Also check for orphaned file records stuck in 'processing' without an active job row
    const orphanedFiles = db.prepare(`
      SELECT f.id, f.user_id, f.original_filename, f.subject, f.file_data
      FROM files f
      LEFT JOIN ocr_jobs j ON f.id = j.file_id
      WHERE f.status = 'processing' AND j.id IS NULL
    `).all();

    for (const orphan of orphanedFiles) {
      if (orphan.file_data) {
        console.log(`[OCR Recovery] Re-queuing orphaned processing file "${orphan.original_filename}" (id=${orphan.id})`);
        enqueueJob({
          fileId: orphan.id,
          userId: orphan.user_id,
          originalName: orphan.original_filename,
          subject: orphan.subject,
          pdfBuffer: orphan.file_data
        });
      } else {
        db.prepare(`
          UPDATE files
          SET status = 'failed', status_message = 'Processing interrupted by server restart.'
          WHERE id = ?
        `).run(orphan.id);
      }
    }
  } catch (err) {
    console.warn('[OCR Recovery] Interrupted job recovery check notice:', err.message);
  }
}

/**
 * Retrieves the comprehensive processing status for a file
 * @param {number} fileId
 * @returns {Object|null}
 */
function getJobStatus(fileId) {
  const file = db.prepare(`
    SELECT f.id, f.note_id, f.original_filename, f.status, f.status_message, f.is_ocr,
           j.id as job_id, j.total_pages, j.processed_pages, j.failed_pages, j.status as job_status
    FROM files f
    LEFT JOIN ocr_jobs j ON f.id = j.file_id
    WHERE f.id = ?
  `).get(fileId);

  if (!file) return null;

  let failedPages = [];
  try {
    failedPages = file.failed_pages ? JSON.parse(file.failed_pages) : [];
  } catch (_) {}

  return {
    fileId: file.id,
    noteId: file.note_id,
    filename: file.original_filename,
    status: file.status || 'ready',
    jobStatus: file.job_status || file.status || 'ready',
    message: file.status_message || '',
    totalPages: file.total_pages || 0,
    processedPages: file.processed_pages || 0,
    failedPages: failedPages,
    isOcr: !!file.is_ocr
  };
}

/**
 * Helper to convert a readable stream into a Buffer
 */
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

module.exports = {
  enqueueJob,
  retryFailedPages,
  recoverInterruptedJobs,
  getJobStatus,
  processQueue
};
