/**
 * SmartNotes - Optical Character Recognition (OCR) Service (services/ocr.js)
 * Converts scanned/image-only PDFs into readable academic text using
 * system-native Tesseract OCR and Poppler utilities (pdftoppm).
 * Designed for Docker/Linux deployments on Render with memory & page limits.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const util = require('util');

const execFilePromise = util.promisify(execFile);

// Resource and processing safeguards for Render free tier (512MB RAM limit)
const OCR_CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10 MB maximum
  maxOcrPages: 15,               // Max pages to OCR to prevent timeout & memory exhaustion
  dpi: 150,                     // 150 DPI is optimal for OCR accuracy vs RAM/disk usage
  pageTimeoutMs: 25000,         // 25s per page OCR timeout
  convertTimeoutMs: 45000,      // 45s PDF-to-image conversion timeout
  minWordsRequired: 5,          // Minimum meaningful words to consider extraction successful
  language: 'eng'               // Default Tesseract language
};

// Test hook for mock/simulation in environments without native binaries
let mockOCRHandler = null;

/**
 * Checks if a specific CLI executable is available on the system PATH
 * @param {string} command - Command name (e.g. 'tesseract', 'pdftoppm')
 * @returns {Promise<boolean>}
 */
async function isCommandAvailable(command) {
  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? 'where' : 'which';
    await execFilePromise(checkCmd, [command]);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Checks if native OCR tools (Tesseract and pdftoppm) are available
 * @returns {Promise<{ available: boolean, tesseract: boolean, pdftoppm: boolean }>}
 */
async function checkOCREnvironment() {
  if (mockOCRHandler) {
    return { available: true, tesseract: true, pdftoppm: true };
  }
  const [hasTesseract, hasPdftoppm] = await Promise.all([
    isCommandAvailable('tesseract'),
    isCommandAvailable('pdftoppm')
  ]);
  return {
    available: hasTesseract && hasPdftoppm,
    tesseract: hasTesseract,
    pdftoppm: hasPdftoppm
  };
}

/**
 * Retrieves the total number of pages in a PDF using pdfinfo or regex heuristic
 * @param {string} pdfPath
 * @returns {Promise<number>}
 */
async function getPdfPageCount(pdfPath) {
  try {
    const { stdout } = await execFilePromise('pdfinfo', [pdfPath], { timeout: 10000 });
    const match = stdout.match(/Pages:\s+(\d+)/i);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  } catch (_) {
    // pdfinfo not available or failed; fallback to inspecting buffer
  }

  try {
    const buffer = fs.readFileSync(pdfPath);
    const content = buffer.toString('latin1');
    const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatches && pageMatches.length > 0) {
      return pageMatches.length;
    }
  } catch (_) {}

  return 1; // Default fallback
}

/**
 * Converts a PDF into PNG image files using pdftoppm
 * @param {string} pdfPath - Path to source PDF
 * @param {string} outputDir - Directory to write PNG images
 * @param {number} maxPages - Maximum pages to convert
 * @returns {Promise<string[]>} Array of image file paths sorted by page number
 */
async function convertPdfToImages(pdfPath, outputDir, maxPages = OCR_CONFIG.maxOcrPages) {
  const prefix = path.join(outputDir, 'page');
  const args = [
    '-png',
    '-r', String(OCR_CONFIG.dpi),
    '-f', '1',
    '-l', String(maxPages),
    pdfPath,
    prefix
  ];

  await execFilePromise('pdftoppm', args, {
    timeout: OCR_CONFIG.convertTimeoutMs,
    maxBuffer: 10 * 1024 * 1024
  });

  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('page') && f.endsWith('.png'))
    .sort((a, b) => {
      // Natural sort by page number extracted from filename (e.g. page-1.png vs page-10.png)
      const numA = parseInt((a.match(/\d+/) || [0])[0], 10);
      const numB = parseInt((b.match(/\d+/) || [0])[0], 10);
      return numA - numB;
    })
    .map(f => path.join(outputDir, f));

  if (files.length === 0) {
    throw new Error('PDF-to-image conversion generated 0 image pages. The file may be corrupt.');
  }

  return files;
}

/**
 * Runs Tesseract OCR on a single image file
 * Supports orientation detection (PSM 1) with fallback to standard segmentation (PSM 3)
 * @param {string} imagePath
 * @returns {Promise<string>} Extracted plain text
 */
async function ocrImageFile(imagePath) {
  // First attempt: PSM 1 (Automatic page segmentation with OSD - handles rotated pages)
  try {
    const { stdout } = await execFilePromise('tesseract', [
      imagePath,
      'stdout',
      '-l', OCR_CONFIG.language,
      '--oem', '1',
      '--psm', '1'
    ], {
      timeout: OCR_CONFIG.pageTimeoutMs,
      maxBuffer: 5 * 1024 * 1024
    });

    const text = (stdout || '').trim();
    if (text.length > 0) {
      return text;
    }
  } catch (osdErr) {
    // If PSM 1 fails (e.g. OSD missing or orientation indeterminate), fall back to PSM 3
  }

  // Second attempt: PSM 3 (Fully automatic page segmentation without OSD)
  try {
    const { stdout } = await execFilePromise('tesseract', [
      imagePath,
      'stdout',
      '-l', OCR_CONFIG.language,
      '--oem', '1',
      '--psm', '3'
    ], {
      timeout: OCR_CONFIG.pageTimeoutMs,
      maxBuffer: 5 * 1024 * 1024
    });

    return (stdout || '').trim();
  } catch (err) {
    throw new Error(`Tesseract OCR failed on image: ${err.message}`);
  }
}

/**
 * Extracts readable text from a scanned PDF buffer using OCR
 * @param {Buffer} pdfBuffer - Raw PDF file buffer
 * @param {Object} options - Custom options (filename, maxPages)
 * @returns {Promise<{ text: string, pagesProcessed: number, totalPages: number, isOcr: boolean }>}
 */
async function extractTextFromScannedPDF(pdfBuffer, options = {}) {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error('The uploaded PDF file is empty (0 bytes).');
  }

  if (pdfBuffer.length > OCR_CONFIG.maxFileSize) {
    throw new Error(`File size (${Math.round(pdfBuffer.length / (1024 * 1024))} MB) exceeds the 10 MB limit.`);
  }

  // Use test mock handler if active
  if (mockOCRHandler) {
    return await mockOCRHandler(pdfBuffer, options);
  }

  // Verify system binaries exist in the host environment
  const env = await checkOCREnvironment();
  if (!env.available) {
    const missing = [];
    if (!env.tesseract) missing.push('tesseract-ocr');
    if (!env.pdftoppm) missing.push('poppler-utils (pdftoppm)');
    throw new Error(
      `This PDF contains scanned images with no selectable text. OCR requires system packages [${missing.join(', ')}]. These are installed in the Docker deployment on Render.`
    );
  }

  // Create isolated temp workspace
  const tempDir = path.join(
    os.tmpdir(),
    `smartnotes-ocr-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });

  const inputPdfPath = path.join(tempDir, 'document.pdf');
  fs.writeFileSync(inputPdfPath, pdfBuffer);

  try {
    const totalPages = await getPdfPageCount(inputPdfPath);
    const pagesToProcess = Math.min(totalPages, options.maxPages || OCR_CONFIG.maxOcrPages);

    console.log(
      `[OCR] Processing scanned PDF "${options.filename || 'document.pdf'}" (${totalPages} total pages, converting first ${pagesToProcess} pages at ${OCR_CONFIG.dpi} DPI)...`
    );

    const imageFiles = await convertPdfToImages(inputPdfPath, tempDir, pagesToProcess);
    const pageTexts = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const pageNum = i + 1;
      const imgPath = imageFiles[i];
      try {
        const rawPageText = await ocrImageFile(imgPath);
        const cleanedText = rawPageText
          .replace(/\f/g, '')
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        if (cleanedText) {
          pageTexts.push(`--- Page ${pageNum} ---\n${cleanedText}`);
        }
      } catch (pageErr) {
        console.warn(`[OCR] Warning: Failed to process page ${pageNum}:`, pageErr.message);
      }
    }

    let fullText = pageTexts.join('\n\n').trim();

    // Word count validation
    const words = fullText
      .replace(/--- Page \d+ ---/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 1);

    if (!fullText || words.length < OCR_CONFIG.minWordsRequired) {
      throw new Error(
        'OCR completed, but no readable text could be recognized. The scanned document might be blank, severely blurred, or unsupported. Please ensure the scan is clear.'
      );
    }

    if (totalPages > pagesToProcess) {
      fullText += `\n\n[Note: Document contains ${totalPages} pages. The first ${pagesToProcess} pages were processed with OCR to stay within server resource limits.]`;
    }

    console.log(`[OCR] Successfully extracted ${words.length} words across ${pageTexts.length} pages.`);

    return {
      text: fullText,
      pagesProcessed: pageTexts.length,
      totalPages: totalPages,
      isOcr: true
    };
  } finally {
    // Guaranteed cleanup of all temp images and PDFs
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Allows automated tests to set a mock OCR handler
 * @param {Function|null} handler
 */
function setMockOCRHandler(handler) {
  mockOCRHandler = handler;
}

module.exports = {
  extractTextFromScannedPDF,
  checkOCREnvironment,
  isCommandAvailable,
  getPdfPageCount,
  setMockOCRHandler,
  OCR_CONFIG
};
