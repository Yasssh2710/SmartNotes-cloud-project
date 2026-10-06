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

// Configure Multer in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.docx', '.doc', '.txt'];
    const originalName = file.originalname.toLowerCase();
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

    const formatted = files.map(file => ({
      id: file.id,
      noteId: file.note_id,
      name: file.original_filename,
      size: formatFileSize(file.file_size),
      sizeBytes: file.file_size,
      subject: file.subject || 'General',
      date: file.uploaded_at ? file.uploaded_at.split(' ')[0] : new Date().toISOString().split('T')[0],
      status: file.s3_key.startsWith('local:') ? 'Uploaded (Local)' : 'Uploaded (S3)',
      isS3: !file.s3_key.startsWith('local:')
    }));

    return res.json({
      success: true,
      count: formatted.length,
      isS3Configured: s3Service.isS3Configured(),
      files: formatted
    });
  } catch (err) {
    console.error('[Files] Listing error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve uploaded files.' });
  }
});

/**
 * POST /api/files/upload
 * Handles file upload to S3 or local storage, extracts text, and registers note in My Notes
 */
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'File size exceeds the 10 MB limit.' });
      }
      return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file was uploaded.' });
    }

    try {
      const userId = getUserId(req);
      const subject = (req.body.subject && req.body.subject.trim()) ? req.body.subject.trim() : 'Cloud Computing';

      // 1. Extract plain text from PDF, DOCX, or TXT
      let extractedText = '';
      try {
        extractedText = await extractTextFromFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      } catch (extErr) {
        console.error('[Files] Text extraction failed:', extErr.message);
        return res.status(400).json({
          success: false,
          error: `Could not read document text: ${extErr.message}`
        });
      }

      // 2. Upload to S3 or local filesystem fallback
      const { s3Key, isS3 } = await s3Service.uploadFileToStorage(req.file, userId);

      // 3. Save to files table
      const fileInsert = db.prepare(`
        INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, extracted_text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        req.file.originalname,
        s3Key,
        req.file.mimetype || 'application/octet-stream',
        req.file.size,
        subject,
        extractedText
      );
      const fileId = fileInsert.lastInsertRowid;

      // 4. Create corresponding Note entry so it automatically appears in My Notes
      const ext = req.file.originalname.split('.').pop().toUpperCase();
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
        `Uploaded ${ext} Document`,
        `${ext}, Uploaded File`,
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

      return res.status(201).json({
        success: true,
        message: isS3
          ? 'File uploaded to Amazon S3 and added to My Notes successfully.'
          : 'File uploaded and added to My Notes successfully (saved locally - S3 not configured).',
        file: {
          id: fileId,
          noteId: noteId,
          name: req.file.originalname,
          size: formatFileSize(req.file.size),
          subject: subject,
          s3Key: s3Key,
          isS3: isS3
        }
      });
    } catch (uploadErr) {
      console.error('[Files] Processing error:', uploadErr);
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

    const { stream, contentType } = await s3Service.getFileFromStorage(fileRecord.s3_key);
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
    console.error('[Files] Preview error:', err);
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

    const { stream, contentType } = await s3Service.getFileFromStorage(fileRecord.s3_key);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileRecord.original_filename)}"`);

    if (stream.pipe) {
      stream.pipe(res);
    } else {
      res.send(stream);
    }
  } catch (err) {
    console.error('[Files] Download error:', err);
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
      console.warn('[Files] Storage delete notice:', storageErr.message);
    }

    // Delete corresponding note if linked
    if (fileRecord.note_id) {
      db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(fileRecord.note_id, userId);
    }
    db.prepare('DELETE FROM notes WHERE file_id = ? AND user_id = ?').run(fileId, userId);

    db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    return res.json({ success: true, message: 'File and associated note deleted successfully.' });
  } catch (err) {
    console.error('[Files] Deletion error:', err);
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
