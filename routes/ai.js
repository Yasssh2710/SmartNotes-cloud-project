/**
 * SmartNotes - AI Revision Routes (routes/ai.js)
 * Endpoints for Google Gemini note summarization, MCQ quiz generation,
 * and quiz result tracking.
 */

const express = require('express');
const router = express.Router();
const db = require('../database/db');
const aiService = require('../services/ai');

function getUserId(req) {
  if (req.session && req.session.userId) return req.session.userId;
  return 1; // Demo user fallback
}

/**
 * GET /api/ai/status
 * Returns whether Gemini API key is configured in backend environment
 */
router.get('/status', (req, res) => {
  const isConfigured = aiService.isGeminiConfigured();
  return res.json({
    success: true,
    configured: isConfigured,
    message: isConfigured
      ? 'Google Gemini API is configured and ready.'
      : 'AI features are not configured yet.'
  });
});

/**
 * POST /api/ai/summary
 * Generates an AI summary for a selected note
 */
router.post('/summary', async (req, res) => {
  try {
    const userId = getUserId(req);
    let { noteId, fileId, title, content } = req.body;

    if (fileId) {
      const file = db.prepare('SELECT original_filename, extracted_text, subject FROM files WHERE id = ? AND (user_id = ? OR user_id = 1)').get(fileId, userId);
      if (file) {
        title = file.original_filename;
        content = file.extracted_text;
      }
    } else if (noteId) {
      const note = db.prepare(`
        SELECT n.title, n.content, n.subject, f.extracted_text 
        FROM notes n 
        LEFT JOIN files f ON (n.file_id = f.id OR f.note_id = n.id) 
        WHERE n.id = ? AND (n.user_id = ? OR n.user_id = 1)
      `).get(noteId, userId);
      if (note) {
        title = note.title;
        content = (note.extracted_text && note.extracted_text.trim()) ? note.extracted_text : note.content;
      }
    }

    // Ensure the document contains real, readable text rather than empty or scanned image markers
    const cleanText = (content || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleanText.split(/\s+/).filter(w => w.length > 1);

    if (!cleanText || words.length < 5) {
      return res.status(400).json({
        success: false,
        error: 'This document contains no selectable text (scanned or image-only PDF). OCR (Optical Character Recognition) is required to extract text from scanned pages before generating an AI summary or quiz. Please upload a text-based study note.'
      });
    }

    const summary = await aiService.generateNoteSummary(title || 'Academic Note', content);

    return res.json({
      success: true,
      configured: true,
      summary: summary
    });
  } catch (err) {
    if (err.code === 'AI_NOT_CONFIGURED') {
      return res.status(200).json({
        success: false,
        configured: false,
        error: 'AI features are not configured yet. (Set GEMINI_API_KEY in .env)'
      });
    }
    const safeError = aiService.sanitizeErrorMessage ? aiService.sanitizeErrorMessage(err) : (err.message || 'AI service error');
    console.error(`[AI] Summary route error: ${safeError}`);
    return res.status(500).json({
      success: false,
      configured: aiService.isGeminiConfigured(),
      error: safeError || 'Failed to generate AI summary.'
    });
  }
});

/**
 * POST /api/ai/quiz
 * Generates 5 MCQs for a selected note
 */
router.post('/quiz', async (req, res) => {
  try {
    const userId = getUserId(req);
    let { noteId, fileId, title, content } = req.body;

    if (fileId) {
      const file = db.prepare('SELECT original_filename, extracted_text, subject FROM files WHERE id = ? AND (user_id = ? OR user_id = 1)').get(fileId, userId);
      if (file) {
        title = file.original_filename;
        content = file.extracted_text;
      }
    } else if (noteId) {
      const note = db.prepare(`
        SELECT n.title, n.content, n.subject, f.extracted_text 
        FROM notes n 
        LEFT JOIN files f ON (n.file_id = f.id OR f.note_id = n.id) 
        WHERE n.id = ? AND (n.user_id = ? OR n.user_id = 1)
      `).get(noteId, userId);
      if (note) {
        title = note.title;
        content = (note.extracted_text && note.extracted_text.trim()) ? note.extracted_text : note.content;
      }
    }

    // Ensure the document contains real, readable text rather than empty or scanned image markers
    const cleanText = (content || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleanText.split(/\s+/).filter(w => w.length > 1);

    if (!cleanText || words.length < 5) {
      return res.status(400).json({
        success: false,
        error: 'This document contains no selectable text (scanned or image-only PDF). OCR (Optical Character Recognition) is required to extract text from scanned pages before generating an AI summary or quiz. Please upload a text-based study note.'
      });
    }

    const questions = await aiService.generateQuizQuestions(title || 'Academic Note', content);

    return res.json({
      success: true,
      configured: true,
      questions: questions
    });
  } catch (err) {
    if (err.code === 'AI_NOT_CONFIGURED') {
      return res.status(200).json({
        success: false,
        configured: false,
        error: 'AI features are not configured yet. (Set GEMINI_API_KEY in .env)'
      });
    }
    const safeError = aiService.sanitizeErrorMessage ? aiService.sanitizeErrorMessage(err) : (err.message || 'AI service error');
    console.error(`[AI] Quiz route error: ${safeError}`);
    return res.status(500).json({
      success: false,
      configured: aiService.isGeminiConfigured(),
      error: safeError || 'Failed to generate AI quiz.'
    });
  }
});

/**
 * POST /api/ai/quiz-results
 * Records a completed quiz score into QUIZ_RESULTS table
 */
router.post('/quiz-results', (req, res) => {
  try {
    const userId = getUserId(req);
    const { noteId, score, totalQuestions, percentage } = req.body;

    const stmt = db.prepare(`
      INSERT INTO quiz_results (user_id, note_id, score, total_questions, percentage)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      userId,
      noteId ? parseInt(noteId, 10) : null,
      parseInt(score, 10) || 0,
      parseInt(totalQuestions, 10) || 5,
      parseInt(percentage, 10) || 0
    );

    return res.status(201).json({
      success: true,
      message: 'Quiz result saved successfully.',
      resultId: result.lastInsertRowid
    });
  } catch (err) {
    console.error('[AI] Save quiz results error:', err);
    return res.status(500).json({ success: false, error: 'Failed to record quiz results.' });
  }
});

module.exports = router;
