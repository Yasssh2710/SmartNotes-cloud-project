/**
 * SmartNotes - Document Text Extraction Service (services/extractor.js)
 * Extracts textual content from PDF, DOCX, and TXT files for note storage and AI processing.
 */

const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const ocrService = require('./ocr');

/**
 * Extracts readable plain text from uploaded files (PDF, DOCX, TXT)
 * Automatically falls back to OCR for scanned PDFs with no selectable text.
 * @param {Buffer} buffer - File buffer
 * @param {string} originalName - Original filename
 * @param {string} mimetype - MIME type
 * @param {Object} options - Additional extraction options
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromFile(buffer, originalName = '', mimetype = '', options = {}) {
  if (!buffer || buffer.length === 0) {
    throw new Error('The uploaded file is empty (0 bytes).');
  }

  const name = (originalName || '').toLowerCase();

  // 1. Plain Text (.txt)
  if (name.endsWith('.txt') || mimetype === 'text/plain') {
    const text = buffer.toString('utf-8').trim();
    if (!text) {
      throw new Error('The uploaded TXT file contains no readable text.');
    }
    return text;
  }

  // 2. PDF (.pdf)
  if (name.endsWith('.pdf') || mimetype === 'application/pdf') {
    let directText = '';
    let directWords = [];

    // Attempt fast direct text extraction first
    let parser = null;
    try {
      parser = new PDFParse({ data: buffer });
      const parsePromise = parser.getText();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PDF direct text parsing timed out (15s limit)')), 15000)
      );

      const result = await Promise.race([parsePromise, timeoutPromise]);
      const rawText = (result && result.text) ? result.text : '';

      // Strip pdf-parse page delimiter markers like "-- 1 of 22 --"
      const meaningfulText = rawText
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      directWords = meaningfulText.split(/\s+/).filter(w => w.length > 1);

      // Fast path: Text-based PDF has selectable text (5+ words) -> skip OCR
      if (meaningfulText && directWords.length >= 5) {
        console.log(`[Extractor] PDF "${originalName}" is text-based (${directWords.length} words). Extracted directly.`);
        const cleaned = rawText
          .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '\n\n')
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return cleaned;
      }

      if (meaningfulText && directWords.length >= 2) {
        directText = rawText
          .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '\n\n')
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
    } catch (parseErr) {
      console.warn(`[Extractor] Direct text parse unhandled: ${parseErr.message}. Attempting OCR fallback.`);
    } finally {
      if (parser && typeof parser.destroy === 'function') {
        try { await parser.destroy(); } catch (_) {}
      }
    }

    // Scanned or low-text PDF: Automatically invoke OCR to capture scanned content
    console.log(
      `[Extractor] PDF "${originalName}" has no selectable text (${directWords.length} words). Initiating OCR extraction...`
    );

    try {
      const ocrResult = await ocrService.extractTextFromScannedPDF(buffer, {
        filename: originalName,
        ...options
      });

      // If OCR succeeded and extracted text, return it
      if (ocrResult && ocrResult.text && ocrResult.text.trim()) {
        return ocrResult.text;
      }
    } catch (ocrErr) {
      // If OCR failed but direct extraction had partial words, fall back to direct text
      if (directText && directWords.length >= 2) {
        console.warn(`[Extractor] OCR fallback failed (${ocrErr.message}), using partial direct text.`);
        return directText;
      }
      throw new Error(`Failed to extract text from PDF: ${ocrErr.message}`);
    }

    if (directText && directWords.length >= 2) {
      return directText;
    }

    throw new Error('This PDF contains no readable text. Ensure the file is not blank, corrupted, or password-protected.');
  }

  // 3. Word Document (.docx / .doc)
  if (name.endsWith('.docx') || name.endsWith('.doc') || mimetype.includes('word') || mimetype.includes('officedocument')) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const rawText = (result && result.value) ? result.value.trim() : '';
      if (!rawText) {
        throw new Error('The uploaded Word document contains no readable text.');
      }
      return rawText;
    } catch (docxErr) {
      throw new Error(`Failed to read Word document: ${docxErr.message}`);
    }
  }

  throw new Error('Unsupported file format. Please upload a PDF, DOCX, or TXT file.');
}

/**
 * Inspects a PDF buffer to quickly detect if it contains selectable text without invoking OCR.
 * @param {Buffer} buffer - PDF buffer
 * @returns {Promise<{ isText: boolean, text: string, wordCount: number }>}
 */
async function inspectPdfText(buffer) {
  if (!buffer || buffer.length === 0) {
    return { isText: false, text: '', wordCount: 0 };
  }

  let parser = null;
  try {
    parser = new PDFParse({ data: buffer });
    const parsePromise = parser.getText();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PDF direct text inspection timed out (10s)')), 10000)
    );

    const result = await Promise.race([parsePromise, timeoutPromise]);
    const rawText = (result && result.text) ? result.text : '';

    const meaningfulText = rawText
      .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const directWords = meaningfulText.split(/\s+/).filter(w => w.length > 1);

    if (meaningfulText && directWords.length >= 5) {
      const cleaned = rawText
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '\n\n')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return { isText: true, text: cleaned, wordCount: directWords.length };
    }

    return { isText: false, text: meaningfulText, wordCount: directWords.length };
  } catch (err) {
    return { isText: false, text: '', wordCount: 0, error: err.message };
  } finally {
    if (parser && typeof parser.destroy === 'function') {
      try { await parser.destroy(); } catch (_) {}
    }
  }
}

module.exports = {
  extractTextFromFile,
  inspectPdfText
};

