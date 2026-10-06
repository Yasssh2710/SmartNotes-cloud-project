/**
 * SmartNotes - Document Text Extraction Service (services/extractor.js)
 * Extracts textual content from PDF, DOCX, and TXT files for note storage and AI processing.
 */

const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extracts readable plain text from uploaded files (PDF, DOCX, TXT)
 * @param {Buffer} buffer - File buffer
 * @param {string} originalName - Original filename
 * @param {string} mimetype - MIME type
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromFile(buffer, originalName = '', mimetype = '') {
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

      // If there are no real words or only page delimiter artifacts, it's a scanned/image-only PDF
      if (!meaningfulText || words.length < 5) {
        throw new Error(
          'This PDF contains scanned images or photos with no selectable text. OCR (Optical Character Recognition) is required to extract text from scanned documents. Please upload a text-based PDF, DOCX, or TXT file.'
        );
      }

      // Format extracted text: replace page delimiters with clean breaks and normalize spacing
      const cleaned = rawText
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '\n\n')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return cleaned;
    } catch (pdfErr) {
      if (pdfErr.message && (pdfErr.message.includes('scanned') || pdfErr.message.includes('OCR'))) {
        throw pdfErr;
      }
      throw new Error(`Failed to extract text from PDF: ${pdfErr.message}`);
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
