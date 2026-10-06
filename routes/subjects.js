/**
 * SmartNotes - Subjects Management Routes (routes/subjects.js)
 * Enables dynamic subject creation, catalog listing, and curriculum categorization.
 */

const express = require('express');
const router = express.Router();
const db = require('../database/db');

function getUserId(req) {
  if (req.session && req.session.userId) return req.session.userId;
  return 1; // Demo user fallback
}

/**
 * GET /api/subjects
 * Retrieves all curriculum and user-created subjects with note counts
 */
router.get('/', (req, res) => {
  try {
    const userId = getUserId(req);

    // Fetch subjects defined in subjects table
    const subjects = db.prepare(`
      SELECT id, name, description, semester, created_at, user_id
      FROM subjects
      WHERE user_id IS NULL OR user_id = ?
      ORDER BY id ASC
    `).all(userId);

    // Also find any subjects present in user notes that aren't in subjects table yet
    const noteSubjects = db.prepare(`
      SELECT DISTINCT subject FROM notes WHERE user_id = ?
    `).all(userId).map(r => r.subject).filter(Boolean);

    const existingNames = new Set(subjects.map(s => s.name.toLowerCase()));

    for (const name of noteSubjects) {
      if (!existingNames.has(name.toLowerCase())) {
        existingNames.add(name.toLowerCase());
        subjects.push({
          id: null,
          name: name,
          description: `Study materials and revision notes for ${name}.`,
          semester: 'Elective / Custom',
          user_id: userId
        });
      }
    }

    // Attach note count for each subject
    const subjectList = subjects.map(s => {
      const countRow = db.prepare(`
        SELECT COUNT(*) as count FROM notes WHERE user_id = ? AND LOWER(subject) = LOWER(?)
      `).get(userId, s.name);

      return {
        id: s.id,
        name: s.name,
        description: s.description || `Study materials and revision notes for ${s.name}.`,
        semester: s.semester ? `Semester ${s.semester}` : 'Academic Module',
        noteCount: countRow ? countRow.count : 0,
        isCustom: !!s.user_id
      };
    });

    return res.json({
      success: true,
      count: subjectList.length,
      subjects: subjectList
    });
  } catch (err) {
    console.error('[Subjects] Fetch error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve subjects.' });
  }
});

/**
 * POST /api/subjects
 * Creates a new academic subject
 */
router.post('/', (req, res) => {
  try {
    const userId = getUserId(req);
    const { name, description, semester } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Subject name is required.' });
    }

    const cleanName = name.trim();

    // Check if subject already exists
    const existing = db.prepare(`
      SELECT id, name FROM subjects WHERE LOWER(name) = LOWER(?) AND (user_id IS NULL OR user_id = ?)
    `).get(cleanName, userId);

    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'Subject already exists.',
        subject: existing
      });
    }

    const stmt = db.prepare(`
      INSERT INTO subjects (user_id, name, description, semester)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      userId,
      cleanName,
      description ? description.trim() : `Curriculum materials for ${cleanName}.`,
      semester ? String(semester).trim() : 'Elective'
    );

    const newSubject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(result.lastInsertRowid);

    return res.status(201).json({
      success: true,
      message: 'New subject added successfully.',
      subject: newSubject
    });
  } catch (err) {
    console.error('[Subjects] Create error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create subject.' });
  }
});

module.exports = router;
