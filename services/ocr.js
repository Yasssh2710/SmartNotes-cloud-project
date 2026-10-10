/**
 * SmartNotes - Optical Character Recognition (OCR) Service (services/ocr.js)
 * Robust dual-engine OCR service designed for Docker Linux (Render) and local environments:
 *  - Primary Engine (Docker / Linux): Native C++ Tesseract & Poppler (pdftoppm) for high speed & low RAM.
 *  - Secondary Engine (Universal Fallback): pdf-parse in-memory rendering & Tesseract.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const util = require('util');
const { PDFParse } = require('pdf-parse');

const execFilePromise = util.promisify(execFile);

// Resource and processing safeguards for Render free tier (512MB RAM limit)
const OCR_CONFIG = {
  maxFileSize: 25 * 1024 * 1024, // 25 MB maximum
  maxOcrPages: 4,                // Max pages to OCR to prevent timeout & memory exhaustion on Render
  dpi: 150,                     // 150 DPI is optimal for OCR accuracy vs RAM/disk usage
  pageTimeoutMs: 15000,         // 15s per page OCR timeout
  convertTimeoutMs: 30000,      // 30s PDF-to-image conversion timeout
  totalOcrTimeoutMs: 50000,     // 50s total OCR safeguard timeout
  minWordsRequired: 3,          // Minimum meaningful words to consider extraction successful
  language: 'eng'               // Default Tesseract language
};

// Test hook for mock/simulation in testing environments
let mockOCRHandler = null;

// Ensure standard Debian / Linux tessdata paths are known
if (process.platform === 'linux' && !process.env.TESSDATA_PREFIX) {
  const debianTessdataPath = '/usr/share/tesseract-ocr/5/tessdata';
  const genericTessdataPath = '/usr/share/tessdata';
  if (fs.existsSync(debianTessdataPath)) {
    process.env.TESSDATA_PREFIX = debianTessdataPath;
  } else if (fs.existsSync(genericTessdataPath)) {
    process.env.TESSDATA_PREFIX = genericTessdataPath;
  }
}

/**
 * Searches for binary executable in standard system locations without relying on external 'which' command
 * @param {string} name - Binary name ('tesseract', 'pdftoppm', 'pdfinfo')
 * @returns {string} Resolved binary path or command name
 */
function findSystemBinary(name) {
  // Check known Linux / container locations
  const linuxCandidates = [
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/bin/${name}`,
    `/usr/sbin/${name}`
  ];

  for (const candidate of linuxCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch (_) {}
    }
  }

  // Check known Windows locations if running on win32
  if (process.platform === 'win32') {
    const winCandidates = [
      `C:\\Program Files\\Tesseract-OCR\\${name}.exe`,
      `C:\\Program Files (x86)\\Tesseract-OCR\\${name}.exe`,
      path.join(process.env.LOCALAPPDATA || '', `Programs\\Tesseract-OCR\\${name}.exe`),
      path.join(process.env.ProgramFiles || '', `poppler\\bin\\${name}.exe`)
    ];
    for (const candidate of winCandidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // Check PATH entries
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, name + ext);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return name;
}

/**
 * Tests if a binary is genuinely executable and returns working path or null
 * @param {string} name
 * @param {string[]} args
 * @returns {Promise<string|null>}
 */
async function testBinary(name, args = ['--version']) {
  const resolved = findSystemBinary(name);
  try {
    await execFilePromise(resolved, args, { timeout: 8000 });
    return resolved;
  } catch (err) {
    // pdftoppm -v writes output to stderr in standard poppler
    if (err && err.stderr && err.stderr.toLowerCase().includes('pdftoppm version')) {
      return resolved;
    }
    // If testing resolved path failed, test bare command name
    if (resolved !== name) {
      try {
        await execFilePromise(name, args, { timeout: 8000 });
        return name;
      } catch (err2) {
        if (err2 && err2.stderr && err2.stderr.toLowerCase().includes('pdftoppm version')) {
          return name;
        }
      }
    }
    return null;
  }
}

/**
 * Detects the available OCR engines in the current runtime
 * @returns {Promise<{ hasNative: boolean, tesseractPath: string|null, pdftoppmPath: string|null, hasTesseractJs: boolean }>}
 */
async function detectOCREnvironment() {
  if (mockOCRHandler) {
    return {
      hasNative: true,
      tesseractPath: 'mock-tesseract',
      pdftoppmPath: 'mock-pdftoppm',
      hasTesseractJs: true
    };
  }

  const [tesseractPath, pdftoppmPath] = await Promise.all([
    testBinary('tesseract', ['--version']),
    testBinary('pdftoppm', ['-v'])
  ]);

  let hasTesseractJs = false;
  try {
    const tesseractJs = require('tesseract.js');
    if (tesseractJs && typeof tesseractJs.recognize === 'function') {
      hasTesseractJs = true;
    }
  } catch (_) {}

  return {
    hasNative: !!(tesseractPath && pdftoppmPath),
    tesseractPath,
    pdftoppmPath,
    hasTesseractJs
  };
}

/**
 * Retrieves total page count of a PDF using pdfinfo, pdf-parse, or buffer regex
 * @param {string} pdfPath
 * @param {Buffer} pdfBuffer
 * @returns {Promise<number>}
 */
async function getPdfPageCount(pdfPath, pdfBuffer) {
  // 1. Try pdfinfo if available
  const pdfinfoPath = findSystemBinary('pdfinfo');
  try {
    const { stdout } = await execFilePromise(pdfinfoPath, [pdfPath], { timeout: 8000 });
    const match = stdout.match(/Pages:\s+(\d+)/i);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  } catch (_) {}

  // 2. Try pdf-parse document metadata
  if (pdfBuffer) {
    let parser = null;
    try {
      parser = new PDFParse({ data: pdfBuffer });
      const info = await parser.getInfo();
      if (info && (info.total || info.numPages)) {
        return info.total || info.numPages;
      }
    } catch (_) {} finally {
      if (parser && typeof parser.destroy === 'function') {
        try { await parser.destroy(); } catch (_) {}
      }
    }
  }

  // 3. Regex heuristic on PDF buffer
  try {
    const buffer = pdfBuffer || fs.readFileSync(pdfPath);
    const content = buffer.toString('latin1');
    const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatches && pageMatches.length > 0) {
      return pageMatches.length;
    }
  } catch (_) {}

  return 1;
}

/**
 * Converts PDF pages to PNG image files using pdftoppm
 * @param {string} pdftoppmPath
 * @param {string} pdfPath
 * @param {string} outputDir
 * @param {number} maxPages
 * @returns {Promise<string[]>}
 */
async function convertPdfToImagesNative(pdftoppmPath, pdfPath, outputDir, maxPages) {
  const prefix = path.join(outputDir, 'page');
  const args = [
    '-png',
    '-r', String(OCR_CONFIG.dpi),
    '-f', '1',
    '-l', String(maxPages),
    pdfPath,
    prefix
  ];

  await execFilePromise(pdftoppmPath, args, {
    timeout: OCR_CONFIG.convertTimeoutMs,
    maxBuffer: 15 * 1024 * 1024
  });

  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('page') && f.endsWith('.png'))
    .sort((a, b) => {
      const numA = parseInt((a.match(/\d+/) || [0])[0], 10);
      const numB = parseInt((b.match(/\d+/) || [0])[0], 10);
      return numA - numB;
    })
    .map(f => path.join(outputDir, f));

  if (files.length === 0) {
    throw new Error('Native pdftoppm generated 0 image pages.');
  }

  return files;
}

/**
 * Converts PDF pages to PNG buffers using pdf-parse getScreenshot
 * @param {Buffer} pdfBuffer
 * @param {number} maxPages
 * @returns {Promise<Buffer[]>}
 */
async function convertPdfToImagesJs(pdfBuffer, maxPages) {
  let parser = null;
  try {
    parser = new PDFParse({ data: pdfBuffer });
    const screenshots = await parser.getScreenshot({
      first: maxPages,
      imageBuffer: true,
      imageDataUrl: false // Do not generate base64 strings to save memory
    });

    if (!screenshots || !screenshots.pages || screenshots.pages.length === 0) {
      throw new Error('In-memory PDF page renderer produced 0 page screenshots.');
    }

    const buffers = [];
    const count = Math.min(screenshots.pages.length, maxPages);
    for (let i = 0; i < count; i++) {
      const page = screenshots.pages[i];
      if (page && page.data) {
        buffers.push(Buffer.from(page.data));
      }
    }

    return buffers;
  } finally {
    if (parser && typeof parser.destroy === 'function') {
      try { await parser.destroy(); } catch (_) {}
    }
  }
}

/**
 * Runs OCR on an image file using native Tesseract CLI
 * @param {string} tesseractPath
 * @param {string} imagePath
 * @returns {Promise<string>}
 */
async function ocrImageNative(tesseractPath, imagePath) {
  const baseArgs = [imagePath, 'stdout', '-l', OCR_CONFIG.language, '--oem', '1'];

  // Add tessdata-dir flag if TESSDATA_PREFIX is configured
  if (process.env.TESSDATA_PREFIX && fs.existsSync(process.env.TESSDATA_PREFIX)) {
    baseArgs.push('--tessdata-dir', process.env.TESSDATA_PREFIX);
  }

  // Fast direct attempt: PSM 3 (Fully automatic page segmentation)
  try {
    const { stdout } = await execFilePromise(tesseractPath, [
      ...baseArgs,
      '--psm', '3'
    ], {
      timeout: OCR_CONFIG.pageTimeoutMs,
      maxBuffer: 5 * 1024 * 1024
    });
    const text = (stdout || '').trim();
    if (text.length > 0) return text;
  } catch (_) {
    // If PSM 3 fails, fall back to PSM 1
  }

  // Fallback attempt: PSM 1 (Automatic with OSD)
  try {
    const { stdout } = await execFilePromise(tesseractPath, [
      ...baseArgs,
      '--psm', '1'
    ], {
      timeout: OCR_CONFIG.pageTimeoutMs,
      maxBuffer: 5 * 1024 * 1024
    });
    return (stdout || '').trim();
  } catch (err) {
    throw new Error(`Native Tesseract OCR failed on page: ${err.message}`);
  }
}

/**
 * Runs OCR on an image buffer using Tesseract.js with local traineddata
 * @param {Buffer} imageBuffer
 * @returns {Promise<string>}
 */
async function ocrImageJs(imageBuffer) {
  const Tesseract = require('tesseract.js');
  const projectRoot = path.resolve(__dirname, '..');
  const options = fs.existsSync(path.join(projectRoot, 'eng.traineddata'))
    ? { langPath: projectRoot, gzip: false }
    : (process.env.TESSDATA_PREFIX && fs.existsSync(process.env.TESSDATA_PREFIX) ? { langPath: process.env.TESSDATA_PREFIX, gzip: false } : {});

  const result = await Promise.race([
    Tesseract.recognize(imageBuffer, OCR_CONFIG.language, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Tesseract page recognition timed out')), OCR_CONFIG.pageTimeoutMs)
    )
  ]);
  return (result && result.data && result.data.text) ? result.data.text.trim() : '';
}

/**
 * Main entry point: extracts text from a scanned PDF buffer using OCR
 * @param {Buffer} pdfBuffer - File buffer
 * @param {Object} options - Custom options (filename, maxPages)
 * @returns {Promise<{ text: string, pagesProcessed: number, totalPages: number, isOcr: boolean, engine: string }>}
 */
async function extractTextFromScannedPDF(pdfBuffer, options = {}) {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error('The uploaded PDF file is empty (0 bytes).');
  }

  if (pdfBuffer.length > OCR_CONFIG.maxFileSize) {
    throw new Error(`File size (${Math.round(pdfBuffer.length / (1024 * 1024))} MB) exceeds the 25 MB limit.`);
  }

  // Use test mock handler if active
  if (mockOCRHandler) {
    return await mockOCRHandler(pdfBuffer, options);
  }

  const env = await detectOCREnvironment();
  if (!env.hasNative && !env.hasTesseractJs) {
    throw new Error(
      'OCR processing is unavailable on this server because neither native Tesseract nor Tesseract.js is installed.'
    );
  }

  const tempDir = path.join(
    os.tmpdir(),
    `smartnotes-ocr-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });

  const inputPdfPath = path.join(tempDir, 'document.pdf');
  fs.writeFileSync(inputPdfPath, pdfBuffer);

  const doOCR = async () => {
    const totalPages = await getPdfPageCount(inputPdfPath, pdfBuffer);
    const maxPages = options.maxPages || OCR_CONFIG.maxOcrPages;
    const pagesToProcess = Math.min(totalPages, maxPages);

    const pageTexts = [];
    let engineUsed = 'native';

    // 1. Try Native Engine (Docker / Render)
    if (env.hasNative) {
      try {
        console.log(
          `[OCR] Running native engine on "${options.filename || 'document.pdf'}" (${totalPages} total pages, processing ${pagesToProcess})...`
        );
        const imageFiles = await convertPdfToImagesNative(env.pdftoppmPath, inputPdfPath, tempDir, pagesToProcess);

        for (let i = 0; i < imageFiles.length; i++) {
          const pageNum = i + 1;
          const imgPath = imageFiles[i];
          try {
            const rawText = await ocrImageNative(env.tesseractPath, imgPath);
            const cleaned = rawText
              .replace(/\f/g, '')
              .replace(/\r\n/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .trim();

            if (cleaned) {
              pageTexts.push(`--- Page ${pageNum} ---\n${cleaned}`);
            }
          } catch (pageErr) {
            console.warn(`[OCR] Native page ${pageNum} warning:`, pageErr.message);
          }
        }
      } catch (nativeErr) {
        console.warn(`[OCR] Native engine encountered error: ${nativeErr.message}. Falling back to Tesseract.js.`);
        pageTexts.length = 0; // Reset for fallback
      }
    }

    // 2. Fallback to Tesseract.js if native produced no pages or is unavailable
    if (pageTexts.length === 0 && env.hasTesseractJs) {
      engineUsed = 'tesseract.js';
      console.log(
        `[OCR] Running Tesseract.js engine on "${options.filename || 'document.pdf'}" (${totalPages} pages, processing ${pagesToProcess})...`
      );

      const imageBuffers = await convertPdfToImagesJs(pdfBuffer, pagesToProcess);
      for (let i = 0; i < imageBuffers.length; i++) {
        const pageNum = i + 1;
        try {
          const rawText = await ocrImageJs(imageBuffers[i]);
          const cleaned = rawText
            .replace(/\f/g, '')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          if (cleaned) {
            pageTexts.push(`--- Page ${pageNum} ---\n${cleaned}`);
          }
        } catch (jsErr) {
          console.warn(`[OCR] Tesseract.js page ${pageNum} warning:`, jsErr.message);
        }
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
        'OCR completed, but no readable text could be recognized. The scanned document might be blank, severely blurred, or unsupported. Please ensure the scan contains clear English text.'
      );
    }

    if (totalPages > pagesToProcess) {
      fullText += `\n\n[Note: Document contains ${totalPages} pages. The first ${pagesToProcess} pages were processed with OCR to stay within server resource limits.]`;
    }

    console.log(`[OCR] Extraction succeeded via ${engineUsed} (${words.length} words across ${pageTexts.length} pages).`);

    return {
      text: fullText,
      pagesProcessed: pageTexts.length,
      totalPages: totalPages,
      isOcr: true,
      engine: engineUsed
    };
  };

  try {
    return await Promise.race([
      doOCR(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OCR processing exceeded server time limit.')), OCR_CONFIG.totalOcrTimeoutMs)
      )
    ]);
  } finally {
    // Guaranteed disk cleanup
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
  detectOCREnvironment,
  findSystemBinary,
  testBinary,
  getPdfPageCount,
  ocrImageJs,
  setMockOCRHandler,
  OCR_CONFIG
};
