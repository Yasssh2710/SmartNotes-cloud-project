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
    // Attempt fast direct text extraction first
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      let rawText = (result && result.text) ? result.text : '';

      // Strip pdf-parse page delimiter markers like "-- 1 of 22 --"
      const meaningfulText = rawText
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const words = meaningfulText.split(/\s+/).filter(w => w.length > 1);

      // Fast path: Text-based PDF has sufficient selectable text (skip OCR)
      if (meaningfulText && words.length >= 5) {
        const cleaned = rawText
          .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '\n\n')
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return cleaned;
      }
    } catch (parseErr) {
      console.warn(`[Extractor] Direct text parse unhandled: ${parseErr.message}. Attempting OCR fallback.`);
    }

    // Scanned or image-only PDF: Automatically invoke OCR
    console.log(`[Extractor] PDF "${originalName}" has no selectable text. Initiating OCR extraction...`);
    try {
      const ocrResult = await ocrService.extractTextFromScannedPDF(buffer, {
        filename: originalName,
        ...options
      });
      return ocrResult.text;
    } catch (ocrErr) {
      throw new Error(`Failed to extract text from PDF: ${ocrErr.message}`);
    }
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

module.exports = {
  extractTextFromFile
};
