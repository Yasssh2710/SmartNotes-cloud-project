/**
 * SmartNotes - File Storage & S3 Routes (routes/files.js)
 * Multer file upload handling, format validation, Amazon S3 integration,
 * local storage fallback, text extraction, and file streaming.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../database/db');
const s3Service = require('../services/s3.js');
const { extractTextFromFile } = require('../services/extractor');

// Configure Multer in memory with 25 MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.docx', '.doc', '.txt'];
    const originalName = (file.originalname || '').toLowerCase();
    const hasValidExt = allowedExtensions.some(ext => originalName.endsWith(ext));

    if (!hasValidExt) {
      return cb(new Error('Invalid file type. Only PDF, DOCX, and TXT files are allowed.'));
    }
    cb(null, true);
  }
});

function getUserId(req) {
  if (req.session && req.session.userId) return req.session.userId;
  return 1; // Demo user fallback
}

/**
 * Sanitizes log output to prevent secret leakage
 */
function sanitizeLog(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/(key=|token=|secret=|bearer\s+)[a-z0-9_\-\.]{10,}/gi, '$1[REDACTED]');
}

/**
 * GET /api/files
 * Lists uploaded files for current student
 */
router.get('/', (req, res) => {
  try {
    const userId = getUserId(req);
    const files = db.prepare(`
      SELECT f.id, f.note_id, f.original_filename, f.file_size, f.file_type, f.s3_key, f.uploaded_at,
             COALESCE(f.subject, n.subject, 'General') as subject,
             n.title as note_title
      FROM files f
      LEFT JOIN notes n ON f.note_id = n.id
      WHERE f.user_id = ?
      ORDER BY f.uploaded_at DESC
    `).all(userId);

    const formatted = files.map(file => {
      const isS3 = !file.s3_key.startsWith('db:') && !file.s3_key.startsWith('local:');
      const status = isS3 ? 'Uploaded (S3)' : 'Uploaded (Database)';
      return {
        id: file.id,
        noteId: file.note_id,
        name: file.original_filename,
        size: formatFileSize(file.file_size),
        sizeBytes: file.file_size,
        subject: file.subject || 'General',
        date: file.uploaded_at ? file.uploaded_at.split(' ')[0] : new Date().toISOString().split('T')[0],
        status: status,
        isS3: isS3,
        storageType: isS3 ? 's3' : 'database'
      };
    });

    return res.json({
      success: true,
      count: formatted.length,
      isS3Configured: s3Service.isS3Configured(),
      files: formatted
    });
  } catch (err) {
    console.error('[Files] Listing error:', sanitizeLog(err.message));
    return res.status(500).json({ success: false, error: 'Failed to retrieve uploaded files.' });
  }
});

/**
 * POST /api/files/upload
 * Handles file upload to S3 or Database persistent storage, extracts text, and registers note in My Notes
 */
router.post('/upload', (req, res) => {
  let isResponded = false;
  const timeoutTimer = setTimeout(() => {
    if (!isResponded) {
      isResponded = true;
      console.error('[Files] Upload processing reached server timeout (60s).');
      return res.status(504).json({
        success: false,
        error: 'Upload processing timed out. Please try a smaller or text-based document.'
      });
    }
  }, 60000);

  upload.single('file')(req, res, async (err) => {
    if (isResponded) return;

    if (err instanceof multer.MulterError) {
      clearTimeout(timeoutTimer);
      isResponded = true;
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'File size exceeds the 25 MB limit.' });
      }
      return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    } else if (err) {
      clearTimeout(timeoutTimer);
      isResponded = true;
      return res.status(400).json({ success: false, error: err.message });
    }

    if (!req.file) {
      clearTimeout(timeoutTimer);
      isResponded = true;
      return res.status(400).json({ success: false, error: 'No file was uploaded.' });
    }

    try {
      const userId = getUserId(req);
      const subject = (req.body.subject && req.body.subject.trim()) ? req.body.subject.trim() : 'Cloud Computing';

      console.log(`[Files] Upload received: "${req.file.originalname}" (${formatFileSize(req.file.size)}, MIME: ${req.file.mimetype || 'unknown'}) for subject: "${subject}"`);

      // 1. Extract plain text from PDF, DOCX, or TXT
      let extractedText = '';
      try {
        extractedText = await extractTextFromFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      } catch (extErr) {
        clearTimeout(timeoutTimer);
        isResponded = true;
        console.error('[Files] Text extraction failed:', sanitizeLog(extErr.message));
        return res.status(400).json({
          success: false,
          error: `Could not read document text: ${extErr.message}`
        });
      }

      // 2. Upload to S3 or Database persistent storage fallback
      const { s3Key, isS3, storageType } = await s3Service.uploadFileToStorage(req.file, userId);

      // 3. Save to files table (including file_data BLOB for persistent storage on Render)
      const fileInsert = db.prepare(`
        INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, extracted_text, file_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        req.file.originalname,
        s3Key,
        req.file.mimetype || 'application/octet-stream',
        req.file.size,
        subject,
        extractedText,
        isS3 ? null : req.file.buffer // Store in SQLite BLOB when S3 is not used!
      );
      const fileId = fileInsert.lastInsertRowid;

      // 4. Create corresponding Note entry so it automatically appears in My Notes
      const ext = req.file.originalname.split('.').pop().toUpperCase();
      const isOcr = extractedText.includes('--- Page ');
      const noteTopic = isOcr ? `Scanned ${ext} (OCR Processed)` : `Uploaded ${ext} Document`;
      const noteTags = isOcr ? `${ext}, OCR, Scanned Document` : `${ext}, Uploaded File`;

      const safeHtml = `<div class="uploaded-doc-content"><p>${extractedText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n\n+/g, '</p><p>')
        .replace(/\n/g, '<br>')}</p></div>`;

      const noteInsert = db.prepare(`
        INSERT INTO notes (user_id, file_id, title, subject, topic, tags, content)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        fileId,
        req.file.originalname,
        subject,
        noteTopic,
        noteTags,
        safeHtml
      );
      const noteId = noteInsert.lastInsertRowid;

      // Link file record to note
      db.prepare('UPDATE files SET note_id = ? WHERE id = ?').run(noteId, fileId);

      // Ensure subject is cataloged in subjects table
      try {
        db.prepare(`
          INSERT OR IGNORE INTO subjects (user_id, name, description, semester)
          VALUES (?, ?, ?, ?)
        `).run(userId, subject, `Study materials for ${subject}.`, 'Elective');
      } catch (_) {}

      clearTimeout(timeoutTimer);
      if (isResponded) return;
      isResponded = true;

      console.log(`[Files] Successfully saved "${req.file.originalname}": fileId=${fileId}, noteId=${noteId}, storage=${isS3 ? 'Amazon S3' : 'Database Storage'}`);

      return res.status(201).json({
        success: true,
        message: isOcr
          ? 'File uploaded and scanned pages recognized with OCR into My Notes.'
          : (isS3
            ? 'File uploaded to Amazon S3 and added to My Notes successfully.'
            : 'File uploaded and added to My Notes successfully (saved in Database storage - S3 not configured).'),
        file: {
          id: fileId,
          noteId: noteId,
          name: req.file.originalname,
          size: formatFileSize(req.file.size),
          subject: subject,
          s3Key: s3Key,
          isS3: isS3,
          isOcr: isOcr,
          storageType: storageType || (isS3 ? 's3' : 'database')
        }
      });
    } catch (uploadErr) {
      clearTimeout(timeoutTimer);
      if (isResponded) return;
      isResponded = true;
      console.error('[Files] Processing error:', sanitizeLog(uploadErr.message));
      return res.status(500).json({ success: false, error: uploadErr.message || 'File upload failed.' });
    }
  });
});

/**
 * GET /api/files/:id/preview
 * Streams inline PDF or text for in-browser document preview
 */
router.get('/:id/preview', async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = req.params.id;

    const fileRecord = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(fileId, userId);
    if (!fileRecord) {
      return res.status(404).send('File not found.');
    }

    const { stream, contentType } = await s3Service.getFileFromStorage(fileRecord.s3_key, fileRecord);
    const isPdf = fileRecord.original_filename.toLowerCase().endsWith('.pdf');
    const mime = isPdf ? 'application/pdf' : (contentType || 'application/octet-stream');

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileRecord.original_filename)}"`);

    if (stream.pipe) {
      stream.pipe(res);
    } else {
      res.send(stream);
    }
  } catch (err) {
    console.error('[Files] Preview error:', sanitizeLog(err.message));
    return res.status(500).send('Failed to preview file: ' + err.message);
  }
});

/**
 * GET /api/files/:id/download
 * Streams file download to browser
 */
router.get('/:id/download', async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = req.params.id;

    const fileRecord = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(fileId, userId);
    if (!fileRecord) {
      return res.status(404).send('File not found.');
    }

    const { stream, contentType } = await s3Service.getFileFromStorage(fileRecord.s3_key, fileRecord);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileRecord.original_filename)}"`);

    if (stream.pipe) {
      stream.pipe(res);
    } else {
      res.send(stream);
    }
  } catch (err) {
    console.error('[Files] Download error:', sanitizeLog(err.message));
    return res.status(500).send('Failed to download file: ' + err.message);
  }
});

/**
 * DELETE /api/files/:id
 * Deletes file record, removes from storage, and deletes linked note
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = req.params.id;

    const fileRecord = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(fileId, userId);
    if (!fileRecord) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    // Delete from storage
    try {
      await s3Service.deleteFileFromStorage(fileRecord.s3_key);
    } catch (storageErr) {
      console.warn('[Files] Storage delete notice:', sanitizeLog(storageErr.message));
    }

    // Delete corresponding note if linked
    if (fileRecord.note_id) {
      db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(fileRecord.note_id, userId);
    }
    db.prepare('DELETE FROM notes WHERE file_id = ? AND user_id = ?').run(fileId, userId);

    db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    return res.json({ success: true, message: 'File and associated note deleted successfully.' });
  } catch (err) {
    console.error('[Files] Deletion error:', sanitizeLog(err.message));
    return res.status(500).json({ success: false, error: 'Failed to delete file.' });
  }
});

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

module.exports = router;

