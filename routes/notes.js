/**
 * SmartNotes - Notes Routes (routes/notes.js)
 * Full CRUD operations, search, subject filtering, file linkage, and dashboard statistics.
 */

const express = require('express');
const router = express.Router();
const db = require('../database/db');
const s3Service = require('../services/s3');
const { requireAuth } = require('./auth');

// Helper to get active user ID or fallback to demo user ID 1 for resilience
function getUserId(req) {
  if (req.session && req.session.userId) {
    return req.session.userId;
  }
  return 1;
}

/**
 * GET /api/notes
 * Returns notes with search, subject filter, and sort (includes uploaded files)
 */
router.get('/', (req, res) => {
  try {
    const userId = getUserId(req);
    const { search, subject, sort } = req.query;

    let query = `
      SELECT n.*, f.original_filename, f.file_size, f.s3_key, f.file_type as attached_file_type
      FROM notes n
      LEFT JOIN files f ON (n.file_id = f.id OR f.note_id = n.id)
      WHERE n.user_id = ?
    `;
    const params = [userId];

    // Subject filter
    if (subject && subject.toLowerCase() !== 'all') {
      query += ' AND LOWER(n.subject) = LOWER(?)';
      params.push(subject.trim());
    }

    // Search query
    if (search && search.trim().length > 0) {
      const q = `%${search.trim().toLowerCase()}%`;
      query += ' AND (LOWER(n.title) LIKE ? OR LOWER(n.topic) LIKE ? OR LOWER(n.tags) LIKE ? OR LOWER(n.content) LIKE ?)';
      params.push(q, q, q, q);
    }

    // Sorting
    if (sort === 'oldest') {
      query += ' ORDER BY n.created_at ASC';
    } else if (sort === 'title-asc') {
      query += ' ORDER BY n.title ASC';
    } else if (sort === 'title-desc') {
      query += ' ORDER BY n.title DESC';
    } else {
      query += ' ORDER BY n.created_at DESC';
    }

    const notes = db.prepare(query).all(...params);

    // Parse tags and file metadata for consistent frontend handling
    const formattedNotes = notes.map(note => {
      const isFile = !!(note.file_id || note.original_filename);
      let fileExt = null;
      if (isFile && note.title && note.title.includes('.')) {
        fileExt = note.title.split('.').pop().toUpperCase();
      }

      return {
        ...note,
        isFile: isFile,
        fileExt: fileExt,
        fileSizeFormatted: note.file_size ? formatFileSize(note.file_size) : null,
        tags: note.tags ? note.tags.split(',').map(t => t.trim()).filter(Boolean) : []
      };
    });

    return res.json({ success: true, count: formattedNotes.length, notes: formattedNotes });
  } catch (err) {
    console.error('[Notes] Fetch error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve notes.' });
  }
});

/**
 * GET /api/notes/stats/dashboard
 * Computes dashboard statistics and recent notes
 */
router.get('/stats/dashboard', (req, res) => {
  try {
    const userId = getUserId(req);

    // 1. Total Notes
    const totalNotesRow = db.prepare('SELECT COUNT(*) as count FROM notes WHERE user_id = ?').get(userId);
    const totalNotes = totalNotesRow ? totalNotesRow.count : 0;

    // 2. Distinct Subjects count
    const subjectsRows = db.prepare(`
      SELECT DISTINCT name FROM subjects WHERE user_id IS NULL OR user_id = ?
      UNION
      SELECT DISTINCT subject FROM notes WHERE user_id = ?
    `).all(userId, userId);
    const subjectsCount = Math.max(subjectsRows.length, 6);

    // 3. Uploaded Files
    const filesRow = db.prepare('SELECT COUNT(*) as count FROM files WHERE user_id = ?').get(userId);
    const uploadedFiles = filesRow ? filesRow.count : 0;

    // 4. Quizzes Completed
    const quizzesRow = db.prepare('SELECT COUNT(*) as count FROM quiz_results WHERE user_id = ?').get(userId);
    const quizzesCompleted = quizzesRow ? quizzesRow.count : 0;

    // 5. Recent 4 Notes
    const recentNotes = db.prepare(`
      SELECT n.*, f.original_filename, f.file_size, f.s3_key
      FROM notes n
      LEFT JOIN files f ON (n.file_id = f.id OR f.note_id = n.id)
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 4
    `).all(userId).map(n => ({
      ...n,
      isFile: !!(n.file_id || n.original_filename),
      tags: n.tags ? n.tags.split(',').map(t => t.trim()).filter(Boolean) : []
    }));

    // 6. Notes count per subject
    const subjectStats = db.prepare(`
      SELECT subject, COUNT(*) as count FROM notes WHERE user_id = ? GROUP BY subject
    `).all(userId);

    const subjectsMap = {};
    subjectsRows.forEach(s => {
      if (s.name) subjectsMap[s.name] = 0;
    });
    subjectStats.forEach(s => {
      subjectsMap[s.subject] = s.count;
    });

    return res.json({
      success: true,
      stats: {
        totalNotes,
        totalSubjects: subjectsCount,
        uploadedFiles,
        quizzesCompleted: Math.max(quizzesCompleted, 1),
        recentNotes,
        subjectsMap
      }
    });
  } catch (err) {
    console.error('[Dashboard] Stats error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats.' });
  }
});

/**
 * GET /api/notes/:id
 * Retrieves a single note by ID
 */
router.get('/:id', (req, res) => {
  try {
    const userId = getUserId(req);
    const noteId = req.params.id;

    const note = db.prepare(`
      SELECT n.*, f.original_filename, f.file_size, f.s3_key, f.file_type as attached_file_type
      FROM notes n
      LEFT JOIN files f ON (n.file_id = f.id OR f.note_id = n.id)
      WHERE n.id = ? AND n.user_id = ?
    `).get(noteId, userId);

    if (!note) {
      return res.status(404).json({ success: false, error: 'Study note not found.' });
    }

    note.tags = note.tags ? note.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    note.isFile = !!(note.file_id || note.original_filename);

    if (note.isFile && note.title && note.title.includes('.')) {
      note.fileExt = note.title.split('.').pop().toUpperCase();
    }
    if (note.file_size) {
      note.fileSizeFormatted = formatFileSize(note.file_size);
    }

    // Attach linked file details if available
    const attachedFile = db.prepare(`
      SELECT id, original_filename, file_size, file_type, s3_key, uploaded_at
      FROM files
      WHERE note_id = ? OR id = ?
    `).get(noteId, note.file_id);
    note.attachedFile = attachedFile || null;

    return res.json({ success: true, note });
  } catch (err) {
    console.error('[Notes] Single note fetch error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve note.' });
  }
});

/**
 * POST /api/notes
 * Creates a new study note
 */
router.post('/', (req, res) => {
  try {
    const userId = getUserId(req);
    const { title, subject, topic, tags, content } = req.body;

    if (!title || !subject || !content) {
      return res.status(400).json({ success: false, error: 'Title, subject, and content are required.' });
    }

    const tagsString = Array.isArray(tags) ? tags.join(', ') : (tags || '');

    const stmt = db.prepare(`
      INSERT INTO notes (user_id, title, subject, topic, tags, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(userId, title.trim(), subject.trim(), topic ? topic.trim() : '', tagsString, content);
    const newNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
    newNote.tags = newNote.tags ? newNote.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

    // Ensure subject is cataloged
    try {
      db.prepare('INSERT OR IGNORE INTO subjects (user_id, name) VALUES (?, ?)').run(userId, subject.trim());
    } catch (_) {}

    return res.status(201).json({
      success: true,
      message: 'Note created successfully.',
      note: newNote
    });
  } catch (err) {
    console.error('[Notes] Creation error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create note.' });
  }
});

/**
 * PUT /api/notes/:id
 * Updates an existing study note
 */
router.put('/:id', (req, res) => {
  try {
    const userId = getUserId(req);
    const noteId = req.params.id;
    const { title, subject, topic, tags, content } = req.body;

    const existing = db.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?').get(noteId, userId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Note not found or unauthorized.' });
    }

    const tagsString = Array.isArray(tags) ? tags.join(', ') : (tags || '');

    const stmt = db.prepare(`
      UPDATE notes
      SET title = COALESCE(?, title),
          subject = COALESCE(?, subject),
          topic = COALESCE(?, topic),
          tags = COALESCE(?, tags),
          content = COALESCE(?, content),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(title, subject, topic, tagsString, content, noteId, userId);
    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    updated.tags = updated.tags ? updated.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

    return res.json({
      success: true,
      message: 'Note updated successfully.',
      note: updated
    });
  } catch (err) {
    console.error('[Notes] Update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update note.' });
  }
});

/**
 * DELETE /api/notes/:id
 * Deletes a study note and its associated storage file
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const noteId = req.params.id;

    const note = db.prepare('SELECT id, file_id FROM notes WHERE id = ? AND user_id = ?').get(noteId, userId);
    if (!note) {
      return res.status(404).json({ success: false, error: 'Note not found or unauthorized.' });
    }

    // Delete linked storage file if exists
    const fileRecord = db.prepare('SELECT id, s3_key FROM files WHERE note_id = ? OR id = ?').get(noteId, note.file_id);
    if (fileRecord) {
      try {
        await s3Service.deleteFileFromStorage(fileRecord.s3_key);
      } catch (storageErr) {
        console.warn('[Notes] Storage file deletion warning:', storageErr.message);
      }
      db.prepare('DELETE FROM files WHERE id = ?').run(fileRecord.id);
    }

    // Delete note
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(noteId, userId);

    return res.json({ success: true, message: 'Note deleted successfully.' });
  } catch (err) {
    console.error('[Notes] Deletion error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete note.' });
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
