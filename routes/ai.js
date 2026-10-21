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

    // Helper to check if text contains readable academic content
    const hasReadableContent = (txt) => {
      if (!txt) return false;
      const clean = txt
        .replace(/<[^>]*>/g, ' ')
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
        .replace(/---\s*Page\s+\d+\s*---/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return clean.split(/\s+/).filter(w => w.length > 1).length >= 5;
    };

    if (!hasReadableContent(content)) {
      return res.status(400).json({
        success: false,
        error: 'This document contains no readable text. If this is a scanned document, ensure the scan is clear, oriented properly, and has readable English text.'
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

    // Helper to check if text contains readable academic content
    const hasReadableContent = (txt) => {
      if (!txt) return false;
      const clean = txt
        .replace(/<[^>]*>/g, ' ')
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
        .replace(/---\s*Page\s+\d+\s*---/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return clean.split(/\s+/).filter(w => w.length > 1).length >= 5;
    };

    if (!hasReadableContent(content)) {
      return res.status(400).json({
        success: false,
        error: 'This document contains no readable text. If this is a scanned document, ensure the scan is clear, oriented properly, and has readable English text.'
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

/**
 * GET /api/ai/documents
 * Returns list of accessible documents and notes for Ask My Notes selector
 */
router.get('/documents', (req, res) => {
  try {
    const userId = getUserId(req);

    // Fetch user files
    const files = db.prepare(`
      SELECT f.id as file_id, f.note_id, f.original_filename as title, f.subject,
             f.status, f.status_message, f.is_ocr, f.uploaded_at,
             LENGTH(COALESCE(f.extracted_text, '')) as text_length,
             j.total_pages, j.processed_pages, j.status as job_status
      FROM files f
      LEFT JOIN ocr_jobs j ON f.id = j.file_id
      WHERE f.user_id = ? OR f.user_id = 1
      ORDER BY f.uploaded_at DESC
    `).all(userId);

    // Fetch user notes that do not have a linked file
    const notes = db.prepare(`
      SELECT n.id as note_id, n.file_id, n.title, n.subject, n.created_at,
             LENGTH(COALESCE(n.content, '')) as text_length
      FROM notes n
      WHERE (n.user_id = ? OR n.user_id = 1) AND (n.file_id IS NULL OR n.file_id NOT IN (SELECT id FROM files))
      ORDER BY n.created_at DESC
    `).all(userId);

    const documents = [];

    for (const f of files) {
      const isReady = f.status === 'ready' && f.text_length > 10;
      documents.push({
        id: `file-${f.file_id}`,
        fileId: f.file_id,
        noteId: f.note_id,
        title: f.title,
        subject: f.subject || 'General',
        status: f.status || 'ready',
        statusMessage: f.status_message || '',
        isReady: isReady,
        isOcr: !!f.is_ocr,
        totalPages: f.total_pages || null,
        processedPages: f.processed_pages || null,
        sourceType: 'file'
      });
    }

    for (const n of notes) {
      documents.push({
        id: `note-${n.note_id}`,
        fileId: null,
        noteId: n.note_id,
        title: n.title,
        subject: n.subject || 'General',
        status: 'ready',
        statusMessage: '',
        isReady: n.text_length > 10,
        isOcr: false,
        totalPages: null,
        processedPages: null,
        sourceType: 'note'
      });
    }

    return res.json({
      success: true,
      documents: documents
    });
  } catch (err) {
    console.error('[AI] Get documents error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve documents.' });
  }
});

/**
 * POST /api/ai/ask
 * Answers a question grounded strictly in the selected document's content
 */
router.post('/ask', async (req, res) => {
  try {
    const userId = getUserId(req);
    let { fileId, noteId, question, history } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid question about your document.'
      });
    }

    let title = 'Study Note';
    let content = '';
    let documentStatus = 'ready';

    if (fileId) {
      const file = db.prepare(`
        SELECT id, original_filename, extracted_text, status, status_message, subject
        FROM files
        WHERE id = ? AND (user_id = ? OR user_id = 1)
      `).get(fileId, userId);

      if (!file) {
        return res.status(404).json({ success: false, error: 'Document not found or access denied.' });
      }

      title = file.original_filename;
      content = file.extracted_text || '';
      documentStatus = file.status;

      if (documentStatus === 'processing') {
        return res.status(400).json({
          success: false,
          status: 'processing',
          error: 'This document is still processing OCR. Please wait until processing completes before asking questions.'
        });
      }

      if (documentStatus === 'failed') {
        return res.status(400).json({
          success: false,
          status: 'failed',
          error: 'OCR processing failed on this document. No readable text could be recognized.'
        });
      }
    } else if (noteId) {
      const note = db.prepare(`
        SELECT n.id, n.title, n.content, n.subject, f.extracted_text, f.status as file_status
        FROM notes n
        LEFT JOIN files f ON (n.file_id = f.id OR f.note_id = n.id)
        WHERE n.id = ? AND (n.user_id = ? OR n.user_id = 1)
      `).get(noteId, userId);

      if (!note) {
        return res.status(404).json({ success: false, error: 'Note not found or access denied.' });
      }

      title = note.title;
      content = (note.extracted_text && note.extracted_text.trim()) ? note.extracted_text : note.content;
      documentStatus = note.file_status || 'ready';

      if (documentStatus === 'processing') {
        return res.status(400).json({
          success: false,
          status: 'processing',
          error: 'This document is still processing OCR. Please wait until processing completes before asking questions.'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Please select a document or note to ask questions.'
      });
    }

    // Helper to check readable content
    const hasReadableContent = (txt) => {
      if (!txt) return false;
      const clean = txt
        .replace(/<[^>]*>/g, ' ')
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
        .replace(/---\s*Page\s+\d+\s*---/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return clean.split(/\s+/).filter(w => w.length > 1).length >= 5;
    };

    if (!hasReadableContent(content)) {
      return res.status(400).json({
        success: false,
        error: 'This document contains no readable text. If this is a scanned document, ensure the scan is clear, oriented properly, and has readable English text.'
      });
    }

    const result = await aiService.askDocumentQuestion({
      title,
      content,
      question: question.trim(),
      history: Array.isArray(history) ? history : []
    });

    return res.json({
      success: true,
      answer: result.answer,
      sources: result.sources || [],
      documentTitle: result.documentTitle || title
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
    console.error(`[AI] Ask route error: ${safeError}`);
    return res.status(500).json({
      success: false,
      configured: aiService.isGeminiConfigured(),
      error: safeError || 'Failed to generate answer from notes.'
    });
  }
});

module.exports = router;
