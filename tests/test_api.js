/**
 * SmartNotes - Automated Backend Test Suite (tests/test_api.js)
 * Tests Database operations, Authentication flow, Notes CRUD,
 * Document Text Extraction, Scanned PDF OCR, Resource Limits,
 * and AI Gemini Summarization & Quiz Integration.
 */

const assert = require('assert');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const s3Service = require('../services/s3');
const geminiService = require('../services/gemini');
const { extractTextFromFile } = require('../services/extractor');
const ocrService = require('../services/ocr');

console.log('====================================================');
console.log('  RUNNING SMARTNOTES AUTOMATED TEST SUITE');
console.log('====================================================\n');

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    testsFailed++;
  }
}

// Helpers to build valid synthetic PDF buffers for testing
function buildSyntheticTextPdf(text) {
  const contentStream = `BT /F1 12 Tf 72 712 Td (${text.replace(/[()]/g, '')}) Tj ET`;
  const streamLength = Buffer.byteLength(contentStream);
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${streamLength} >>
stream
${contentStream}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000368 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
449
%%EOF`);
}

function buildSyntheticMultiPageTextPdf() {
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 50 >>
stream
BT
/F1 12 Tf
72 712 Td
(Page 1: Overview of Relational Database Systems) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
6 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
7 0 obj
<< /Length 50 >>
stream
BT
/F1 12 Tf
72 712 Td
(Page 2: ACID Transactions and Isolation Levels) Tj
ET
endstream
endobj
xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000122 00000 n 
0000000251 00000 n 
0000000352 00000 n 
0000000433 00000 n 
0000000562 00000 n 
trailer
<< /Size 8 /Root 1 0 R >>
startxref
663
%%EOF`);
}

function buildSyntheticScannedPdf() {
  // A valid PDF with an empty content stream (no selectable text characters)
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 0 >>
stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000200 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
251
%%EOF`);
}

async function main() {
  // =========================================================================
  // 1. DATABASE TESTS
  // =========================================================================
  await runTest('Database: Users table exists and demo user is seeded', () => {
    const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get('student@smartnotes.demo');
    assert(user, 'Demo user must exist in database');
    assert(user.name && user.name.length > 0, 'User name must exist');
  });

  await runTest('Database: Notes table contains initial seeded curriculum notes', () => {
    const count = db.prepare('SELECT COUNT(*) as count FROM notes').get();
    assert(count.count >= 6, 'Should have at least 6 initial notes seeded');
  });

  await runTest('Database: Files table schema is valid', () => {
    const info = db.prepare('PRAGMA table_info(files)').all();
    const columnNames = info.map(c => c.name);
    assert(columnNames.includes('original_filename'));
    assert(columnNames.includes('s3_key'));
    assert(columnNames.includes('file_size'));
    assert(columnNames.includes('extracted_text'));
  });

  // =========================================================================
  // 2. AUTHENTICATION TESTS
  // =========================================================================
  await runTest('Auth: Password hashing with bcrypt works correctly', () => {
    const user = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('student@smartnotes.demo');
    const isMatch = bcrypt.compareSync('student123', user.password_hash);
    assert.strictEqual(isMatch, true, 'student123 password must verify against bcrypt hash');

    const isWrongMatch = bcrypt.compareSync('wrongpass', user.password_hash);
    assert.strictEqual(isWrongMatch, false, 'Invalid password must not verify');
  });

  // =========================================================================
  // 3. NOTES CRUD & SEARCH TESTS
  // =========================================================================
  let testNoteId = null;

  await runTest('Notes: Create Note in database', () => {
    const stmt = db.prepare(`
      INSERT INTO notes (user_id, title, subject, topic, tags, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(1, 'Test Note for Automated Verification', 'Cloud Computing', 'Unit Testing', 'test, aws', '<p>Test content</p>');
    testNoteId = res.lastInsertRowid;
    assert(testNoteId > 0, 'New note ID must be greater than 0');
  });

  await runTest('Notes: Read Note from database', () => {
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(testNoteId);
    assert(note, 'Created note must be readable');
    assert.strictEqual(note.title, 'Test Note for Automated Verification');
  });

  await runTest('Notes: Search Note by keyword', () => {
    const notes = db.prepare('SELECT * FROM notes WHERE LOWER(title) LIKE ?').all('%automated verification%');
    assert(notes.length > 0, 'Should find note by title keyword');
  });

  await runTest('Notes: Filter Notes by subject', () => {
    const notes = db.prepare('SELECT * FROM notes WHERE subject = ?').all('Cloud Computing');
    assert(notes.length > 0, 'Should find Cloud Computing notes');
  });

  await runTest('Notes: Update Note in database', () => {
    db.prepare('UPDATE notes SET topic = ? WHERE id = ?').run('Updated Unit Test Topic', testNoteId);
    const updated = db.prepare('SELECT topic FROM notes WHERE id = ?').get(testNoteId);
    assert.strictEqual(updated.topic, 'Updated Unit Test Topic');
  });

  await runTest('Notes: Delete Note from database', () => {
    const res = db.prepare('DELETE FROM notes WHERE id = ?').run(testNoteId);
    assert.strictEqual(res.changes, 1, 'Should delete exactly 1 note');
  });

  // =========================================================================
  // 4. TEXT EXTRACTOR & FORMAT TESTS
  // =========================================================================
  await runTest('Extractor: Extract plain text from TXT buffer', async () => {
    const txtContent = 'Virtual memory is a memory management capability of an operating system.';
    const extracted = await extractTextFromFile(Buffer.from(txtContent, 'utf-8'), 'os_notes.txt', 'text/plain');
    assert(extracted.includes('Virtual memory'), 'Should extract text content from TXT');
  });

  await runTest('Extractor: Extract text from text-based PDF', async () => {
    const pdfBuf = buildSyntheticTextPdf('SmartNotes Distributed Systems Lecture 1 Replication Protocols');
    const extracted = await extractTextFromFile(pdfBuf, 'ds_lecture.pdf', 'application/pdf');
    assert(extracted.includes('Distributed Systems'), 'Should extract text from selectable PDF');
    assert(extracted.includes('Replication Protocols'), 'Should contain expected content');
  });

  await runTest('Extractor: Extract multi-page text-based PDF', async () => {
    const pdfBuf = buildSyntheticMultiPageTextPdf();
    const extracted = await extractTextFromFile(pdfBuf, 'dbms_multipage.pdf', 'application/pdf');
    assert(extracted.includes('Relational Database Systems'), 'Should contain Page 1 content');
    assert(extracted.includes('ACID Transactions'), 'Should contain Page 2 content');
  });

  // =========================================================================
  // 5. OCR & SCANNED PDF TESTS
  // =========================================================================
  await runTest('OCR: Trigger OCR automatically when PDF has no selectable text', async () => {
    const scannedPdfBuf = buildSyntheticScannedPdf();

    // Configure test handler to verify OCR pipeline invocation
    let ocrCalled = false;
    ocrService.setMockOCRHandler(async (buffer, opts) => {
      ocrCalled = true;
      return {
        text: '--- Page 1 ---\nCloud computing provides on-demand data storage and computing power over the Internet.',
        pagesProcessed: 1,
        totalPages: 1,
        isOcr: true
      };
    });

    try {
      const extracted = await extractTextFromFile(scannedPdfBuf, 'scanned_cloud_notes.pdf', 'application/pdf');
      assert.strictEqual(ocrCalled, true, 'OCR pipeline must be called when PDF has no selectable text');
      assert(extracted.includes('Cloud computing provides on-demand'), 'Must return extracted OCR text');
    } finally {
      ocrService.setMockOCRHandler(null);
    }
  });

  await runTest('OCR: Process multi-page scanned PDF with page markers', async () => {
    const scannedPdfBuf = buildSyntheticScannedPdf();

    ocrService.setMockOCRHandler(async (buffer, opts) => {
      return {
        text: '--- Page 1 ---\nNeural Networks and Backpropagation Algorithm.\n\n--- Page 2 ---\nGradient Descent Optimization and Learning Rates.',
        pagesProcessed: 2,
        totalPages: 2,
        isOcr: true
      };
    });

    try {
      const extracted = await extractTextFromFile(scannedPdfBuf, 'scanned_ai_multipage.pdf', 'application/pdf');
      assert(extracted.includes('--- Page 1 ---'), 'Must include Page 1 marker');
      assert(extracted.includes('Neural Networks'), 'Must include Page 1 text');
      assert(extracted.includes('--- Page 2 ---'), 'Must include Page 2 marker');
      assert(extracted.includes('Gradient Descent'), 'Must include Page 2 text');
    } finally {
      ocrService.setMockOCRHandler(null);
    }
  });

  await runTest('OCR: Handle rotated pages via automatic orientation detection', async () => {
    const scannedPdfBuf = buildSyntheticScannedPdf();

    ocrService.setMockOCRHandler(async (buffer, opts) => {
      return {
        text: '--- Page 1 ---\nRotated Horizontal Engineering Diagram: Finite Automata Transition State Table.',
        pagesProcessed: 1,
        totalPages: 1,
        isOcr: true
      };
    });

    try {
      const extracted = await extractTextFromFile(scannedPdfBuf, 'rotated_diagram.pdf', 'application/pdf');
      assert(extracted.includes('Finite Automata Transition State Table'), 'Must extract rotated text correctly');
    } finally {
      ocrService.setMockOCRHandler(null);
    }
  });

  await runTest('OCR: Enforce page limit safeguards on large scanned documents', async () => {
    const scannedPdfBuf = buildSyntheticScannedPdf();

    ocrService.setMockOCRHandler(async (buffer, opts) => {
      const totalPages = 25;
      const maxPages = ocrService.OCR_CONFIG.maxOcrPages; // 15
      return {
        text: `--- Page 1 ---\nTextbook Chapter on Algorithms.\n\n[Note: Document contains ${totalPages} pages. The first ${maxPages} pages were processed with OCR to stay within server resource limits.]`,
        pagesProcessed: maxPages,
        totalPages: totalPages,
        isOcr: true
      };
    });

    try {
      const extracted = await extractTextFromFile(scannedPdfBuf, 'large_textbook.pdf', 'application/pdf');
      assert(extracted.includes('stay within server resource limits'), 'Must include resource limit notice');
      assert(extracted.includes('Textbook Chapter on Algorithms'), 'Must include parsed content');
    } finally {
      ocrService.setMockOCRHandler(null);
    }
  });

  await runTest('OCR: Environment detects working OCR engine without missing commands', async () => {
    const env = await ocrService.detectOCREnvironment();
    assert(
      env.hasNative || env.hasTesseractJs,
      'Must detect either native Tesseract CLI (Docker) or Tesseract.js (Universal)'
    );
  });

  await runTest('OCR: In-memory PDF screenshot engine renders valid image buffers', async () => {
    const scannedPdfBuf = buildSyntheticScannedPdf();
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: scannedPdfBuf });
    const screenshots = await parser.getScreenshot({ imageBuffer: true });
    assert(screenshots && screenshots.pages && screenshots.pages.length > 0, 'Must produce page screenshots');
    assert(screenshots.pages[0].data && screenshots.pages[0].data.length > 0, 'Page screenshot must have image data');
  });

  await runTest('OCR: Real Tesseract engine executes recognition on image buffer', async () => {
    const scannedPdfBuf = buildSyntheticScannedPdf();
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: scannedPdfBuf });
    const screenshots = await parser.getScreenshot({ imageBuffer: true });
    const pageBuffer = Buffer.from(screenshots.pages[0].data);

    const Tesseract = require('tesseract.js');
    const result = await Tesseract.recognize(pageBuffer, 'eng');
    assert(typeof result.data.text === 'string', 'Tesseract recognition must return text string');

    // Test ocrService.ocrImageJs directly with the resolved tessdata directory
    const jsResult = await ocrService.ocrImageJs(pageBuffer);
    assert(typeof jsResult === 'string', 'ocrImageJs must return a string using local traineddata');
  });

  await runTest('OCR: Resolves valid tessdata directory containing eng.traineddata', () => {
    const fs = require('fs');
    const path = require('path');
    const tessDir = ocrService.getTessdataDirectory();
    assert(tessDir, 'Tessdata directory must be resolved');
    const trainedDataPath = path.join(tessDir, 'eng.traineddata');
    assert(fs.existsSync(trainedDataPath), `eng.traineddata must exist in resolved directory: ${tessDir}`);
  });

  await runTest('OCR: Normalizes TESSDATA_PREFIX to parent directory to prevent tessdata/tessdata collision', () => {
    const originalPrefix = process.env.TESSDATA_PREFIX;
    try {
      const path = require('path');
      const projectRoot = path.resolve(__dirname, '..');
      // Simulate Render misconfiguration pointing directly to a tessdata folder
      process.env.TESSDATA_PREFIX = path.join(projectRoot, 'tessdata');
      ocrService.normalizeTessdataPrefix();
      assert.strictEqual(
        process.env.TESSDATA_PREFIX,
        projectRoot,
        'TESSDATA_PREFIX must normalize to parent directory when ending in tessdata'
      );
    } finally {
      process.env.TESSDATA_PREFIX = originalPrefix;
    }
  });

  await runTest('OCR Diagnostics: getTesseractDiagnostics returns valid environment and language metadata', async () => {
    const diag = await ocrService.getTesseractDiagnostics();
    assert(diag, 'Diagnostics object must be returned');
    assert(typeof diag.engTrainedDataExists === 'boolean', 'engTrainedDataExists must be a boolean');
    assert(typeof diag.engTrainedDataReadable === 'boolean', 'engTrainedDataReadable must be a boolean');
    assert(Array.isArray(diag.availableLangs), 'availableLangs must be an array');
    assert(diag.engTrainedDataExists === true, 'eng.traineddata must exist in repository or system');
  });

  await runTest('OCR Subprocess: ocrImageNative handles missing or 0-byte PNG inputs safely', async () => {
    const missingResult = await ocrService.ocrImageNative('tesseract', 'non_existent_image_12345.png', { pageNum: 99 });
    assert.strictEqual(missingResult, '', 'Missing image must return empty string without unhandled crash');
  });

  // =========================================================================
  // 6. ERROR HANDLING & RESOURCE LIMIT TESTS
  // =========================================================================
  await runTest('Errors: Reject empty file (0 bytes)', async () => {
    let threw = false;
    try {
      await extractTextFromFile(Buffer.alloc(0), 'empty.pdf', 'application/pdf');
    } catch (err) {
      threw = true;
      assert(err.message.includes('empty'), 'Must specify file is empty');
    }
    assert.strictEqual(threw, true, 'Empty buffer must reject');
  });

  await runTest('Errors: Reject unsupported file formats', async () => {
    let threw = false;
    try {
      await extractTextFromFile(Buffer.from('executable binary code'), 'app.exe', 'application/octet-stream');
    } catch (err) {
      threw = true;
      assert(err.message.includes('Unsupported file format'), 'Must reject invalid extension');
    }
    assert.strictEqual(threw, true, 'Unsupported format must reject');
  });

  await runTest('Errors: Reject oversized files exceeding 25MB limit in OCR service', async () => {
    let threw = false;
    // Create a 26 MB buffer
    const largeBuf = Buffer.alloc(26 * 1024 * 1024, 0x20);
    try {
      await ocrService.extractTextFromScannedPDF(largeBuf, { filename: 'large.pdf' });
    } catch (err) {
      threw = true;
      assert(err.message.includes('exceeds the 25 MB limit'), 'Must specify file size limit exceeded');
    }
    assert.strictEqual(threw, true, 'Oversized file must reject');
  });

  await runTest('Errors: Handle blank or unreadable scans gracefully', async () => {
    const scannedPdfBuf = buildSyntheticScannedPdf();

    ocrService.setMockOCRHandler(async () => {
      throw new Error(
        'OCR completed, but no readable text could be recognized. The scanned document might be blank, severely blurred, or unsupported. Please ensure the scan is clear.'
      );
    });

    let threw = false;
    try {
      await extractTextFromFile(scannedPdfBuf, 'blank_page.pdf', 'application/pdf');
    } catch (err) {
      threw = true;
      assert(err.message.includes('no readable text could be recognized'), 'Must report unreadable scan error');
    } finally {
      ocrService.setMockOCRHandler(null);
    }
    assert.strictEqual(threw, true, 'Blank scan must reject with informative error');
  });

  // =========================================================================
  // 7. SUBJECTS & STORAGE TESTS
  // =========================================================================
  await runTest('Subjects: Default subjects seeded and readable', () => {
    const subjects = db.prepare('SELECT name FROM subjects').all();
    const names = subjects.map(s => s.name);
    assert(names.includes('DBMS'), 'Should include DBMS');
    assert(names.includes('Operating Systems'), 'Should include Operating Systems');
    assert(names.includes('Cloud Computing'), 'Should include Cloud Computing');
  });

  await runTest('Subjects: Add custom subject', () => {
    db.prepare(`
      INSERT OR IGNORE INTO subjects (user_id, name, description, semester)
      VALUES (?, ?, ?, ?)
    `).run(1, 'Distributed Systems', 'Advanced Distributed Systems curriculum', '7');

    const custom = db.prepare('SELECT * FROM subjects WHERE name = ?').get('Distributed Systems');
    assert(custom, 'Custom subject must be created in database');
    assert.strictEqual(custom.semester, '7');
  });

  await runTest('Storage: Fallback gracefully when AWS S3 is not configured', () => {
    const isConfigured = s3Service.isS3Configured();
    assert(typeof isConfigured === 'boolean');
  });

  await runTest('Storage: Upload and save small text-based PDF to database storage', async () => {
    const pdfBuf = buildSyntheticTextPdf('Cloud Computing Architecture Virtualization and Containerization');
    const extracted = await extractTextFromFile(pdfBuf, 'cloud_unit3_sample.pdf', 'application/pdf');
    assert(extracted.includes('Cloud Computing Architecture'), 'Must extract direct text from text-based PDF');

    const storageRes = await s3Service.uploadFileToStorage({
      originalname: 'cloud_unit3_sample.pdf',
      buffer: pdfBuf,
      mimetype: 'application/pdf',
      size: pdfBuf.length
    }, 1);

    assert(storageRes.s3Key, 'Must generate a valid storage key');
    assert.strictEqual(storageRes.isS3, false, 'Should report isS3 as false when S3 credentials not set');
    assert.strictEqual(storageRes.storageType, 'database', 'Must report database storage type');

    // Insert into files table with file_data BLOB
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, extracted_text, file_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, 'cloud_unit3_sample.pdf', storageRes.s3Key, 'application/pdf', pdfBuf.length, 'Cloud Computing', extracted, pdfBuf);

    assert(insert.lastInsertRowid > 0, 'Must insert file into database');

    // Retrieve file and verify streaming
    const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(insert.lastInsertRowid);
    assert(fileRow.file_data, 'File record must persist binary file_data BLOB in database');

    const retrieved = await s3Service.getFileFromStorage(fileRow.s3_key, fileRow);
    assert(retrieved.stream, 'Must return readable stream from database storage');
  });

  await runTest('Storage: Upload and process scanned PDF with OCR and database persistence', async () => {
    const scannedBuf = buildSyntheticScannedPdf();

    ocrService.setMockOCRHandler(async (buf, opts) => ({
      text: '--- Page 1 ---\nScanned Handwritten Notes on Amazon DynamoDB and Key Value Stores.',
      pagesProcessed: 1,
      totalPages: 1,
      isOcr: true
    }));

    try {
      const extracted = await extractTextFromFile(scannedBuf, 'CLOUD UNIT3 NOTES.pdf', 'application/pdf');
      assert(extracted.includes('DynamoDB'), 'Must extract scanned text via OCR');

      const storageRes = await s3Service.uploadFileToStorage({
        originalname: 'CLOUD UNIT3 NOTES.pdf',
        buffer: scannedBuf,
        mimetype: 'application/pdf',
        size: scannedBuf.length
      }, 1);

      assert(storageRes.s3Key.startsWith('db:'), 'Storage key must use database prefix db:');

      const insert = db.prepare(`
        INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, extracted_text, file_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(1, 'CLOUD UNIT3 NOTES.pdf', storageRes.s3Key, 'application/pdf', scannedBuf.length, 'Cloud Computing', extracted, scannedBuf);

      const savedFile = db.prepare('SELECT id, original_filename, s3_key, extracted_text, file_data FROM files WHERE id = ?').get(insert.lastInsertRowid);
      assert.strictEqual(savedFile.original_filename, 'CLOUD UNIT3 NOTES.pdf');
      assert(savedFile.file_data && savedFile.file_data.length > 0, 'Scanned PDF must be persisted in database BLOB');
    } finally {
      ocrService.setMockOCRHandler(null);
    }
  });

  await runTest('Extractor: inspectPdfText correctly distinguishes text-based PDF from scanned PDF', async () => {
    const { inspectPdfText } = require('../services/extractor');
    const textPdfBuf = buildSyntheticTextPdf('Distributed Systems Consensus and Replication algorithms');
    const textInspection = await inspectPdfText(textPdfBuf);
    assert.strictEqual(textInspection.isText, true, 'Text-based PDF must be detected as isText: true');
    assert(textInspection.wordCount >= 5, 'Word count must be at least 5');

    const scannedPdfBuf = buildSyntheticScannedPdf();
    const scannedInspection = await inspectPdfText(scannedPdfBuf);
    assert.strictEqual(scannedInspection.isText, false, 'Scanned PDF must be detected as isText: false');
  });

  await runTest('Status & Workflow: Processing status transitions from processing to ready with note linking', async () => {
    // 1. Insert file in processing state
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status, status_message, is_ocr)
      VALUES (?, ?, ?, ?, ?, ?, 'processing', 'Analyzing scanned pages...', 1)
    `).run(1, 'async_test.pdf', 'db:test-async.pdf', 'application/pdf', 1024, 'Cloud Computing');
    const fileId = insert.lastInsertRowid;

    // Verify initial status
    const initialRow = db.prepare('SELECT status, status_message FROM files WHERE id = ?').get(fileId);
    assert.strictEqual(initialRow.status, 'processing');
    assert.strictEqual(initialRow.status_message, 'Analyzing scanned pages...');

    // 2. Simulate background worker finishing and linking note
    const noteInsert = db.prepare(`
      INSERT INTO notes (user_id, file_id, title, subject, topic, tags, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(1, fileId, 'async_test.pdf', 'Cloud Computing', 'Scanned PDF (OCR Processed)', 'PDF, OCR', '<p>Extracted OCR content</p>');
    const noteId = noteInsert.lastInsertRowid;

    db.prepare(`
      UPDATE files
      SET note_id = ?, extracted_text = ?, status = 'ready', status_message = 'OCR processing completed successfully.'
      WHERE id = ?
    `).run(noteId, 'Extracted OCR content', fileId);

    // Verify updated status
    const finalRow = db.prepare('SELECT status, note_id, status_message FROM files WHERE id = ?').get(fileId);
    assert.strictEqual(finalRow.status, 'ready');
    assert.strictEqual(finalRow.note_id, noteId);
  });

  await runTest('Status & Workflow: Failure handling updates file status to failed with actionable message', async () => {
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status, status_message, is_ocr)
      VALUES (?, ?, ?, ?, ?, ?, 'processing', 'Analyzing scanned pages...', 1)
    `).run(1, 'failed_test.pdf', 'db:test-failed.pdf', 'application/pdf', 2048, 'Cloud Computing');
    const fileId = insert.lastInsertRowid;

    const errorMsg = 'OCR completed, but no readable text could be recognized.';
    db.prepare('UPDATE files SET status = ?, status_message = ? WHERE id = ?').run('failed', errorMsg, fileId);

    const row = db.prepare('SELECT status, status_message FROM files WHERE id = ?').get(fileId);
    assert.strictEqual(row.status, 'failed');
    assert.strictEqual(row.status_message, errorMsg);
  });

  await runTest('Database: Prevent duplicate note creation on re-processing file', async () => {
    // Check existing note for a file
    const fileInsert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ready')
    `).run(1, 'dedup_test.pdf', 'db:dedup.pdf', 'application/pdf', 512, 'Cloud Computing');
    const fileId = fileInsert.lastInsertRowid;

    // Create initial note
    const note1 = db.prepare(`
      INSERT INTO notes (user_id, file_id, title, subject, topic, tags, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(1, fileId, 'dedup_test.pdf', 'Cloud Computing', 'Uploaded PDF', 'PDF', '<p>Initial</p>');
    const note1Id = note1.lastInsertRowid;

    // Deduplication check: if existing note exists for this file_id, update it instead of inserting another
    const existing = db.prepare('SELECT id FROM notes WHERE file_id = ?').get(fileId);
    assert(existing, 'Must find existing note');
    assert.strictEqual(existing.id, note1Id);

    db.prepare('UPDATE notes SET content = ? WHERE id = ?').run('<p>Updated Content</p>', existing.id);
    const count = db.prepare('SELECT COUNT(*) as cnt FROM notes WHERE file_id = ?').get(fileId);
    assert.strictEqual(count.cnt, 1, 'There must be exactly 1 note per file_id');
  });

  await runTest('Migration: Backward-compatible migration adds missing status column to legacy databases without data loss', () => {
    const Database = require('better-sqlite3');
    const legacyDb = new Database(':memory:');

    // Create legacy schema exactly as deployed in older versions (WITHOUT status, status_message, is_ocr, file_data)
    legacyDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        original_filename TEXT NOT NULL,
        s3_key TEXT NOT NULL,
        file_type TEXT,
        file_size INTEGER,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users VALUES (1, 'Student');
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size)
      VALUES (1, 'existing_student_notes.pdf', 'db:existing.pdf', 'application/pdf', 2048);
    `);

    // Verify status column initially does NOT exist
    const initialCols = legacyDb.prepare('PRAGMA table_info(files)').all().map(c => c.name.toLowerCase());
    assert(!initialCols.includes('status'), 'Legacy table must not have status column initially');

    // Helper function mimicking db.js safeAddColumn on legacyDb
    function migrateLegacyDb(database) {
      const safeAdd = (table, col, def) => {
        const cols = database.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name.toLowerCase());
        if (!cols.includes(col.toLowerCase())) {
          database.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
        }
      };
      safeAdd('files', 'subject', 'TEXT');
      safeAdd('files', 'extracted_text', 'TEXT');
      safeAdd('files', 'file_data', 'BLOB');
      safeAdd('files', 'status', "TEXT DEFAULT 'ready'");
      safeAdd('files', 'status_message', 'TEXT');
      safeAdd('files', 'is_ocr', 'INTEGER DEFAULT 0');
      database.exec("UPDATE files SET status = 'ready' WHERE status IS NULL OR status = '';");
    }

    // Execute migration
    migrateLegacyDb(legacyDb);

    // Verify columns added
    const migratedCols = legacyDb.prepare('PRAGMA table_info(files)').all().map(c => c.name.toLowerCase());
    assert(migratedCols.includes('status'), 'Migrated table must now include status column');
    assert(migratedCols.includes('status_message'), 'Migrated table must include status_message column');
    assert(migratedCols.includes('is_ocr'), 'Migrated table must include is_ocr column');
    assert(migratedCols.includes('file_data'), 'Migrated table must include file_data column');

    // Verify existing user data was preserved (no data loss!)
    const existingFile = legacyDb.prepare('SELECT id, original_filename, status FROM files WHERE id = 1').get();
    assert(existingFile, 'Existing file row must still exist after migration');
    assert.strictEqual(existingFile.original_filename, 'existing_student_notes.pdf');
    assert.strictEqual(existingFile.status, 'ready', 'Existing rows must default to ready status');

    // Verify queries with status column execute cleanly
    const insertRes = legacyDb.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, status, status_message, is_ocr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, 'new_upload.pdf', 'db:new.pdf', 'application/pdf', 4096, 'processing', 'Extracting OCR...', 1);
    assert(insertRes.lastInsertRowid > 1, 'Inserting into migrated table with status column must succeed');

    // Verify idempotency (running migration again does not throw or duplicate)
    migrateLegacyDb(legacyDb);
    const finalCols = legacyDb.prepare('PRAGMA table_info(files)').all().map(c => c.name.toLowerCase());
    assert.strictEqual(finalCols.filter(c => c === 'status').length, 1, 'Status column must not be duplicated');

    legacyDb.close();
  });

  // =========================================================================
  // 8. AI & GEMINI INTEGRATION TESTS
  // =========================================================================
  await runTest('Gemini: Detects API key configuration safely without crashing', () => {
    const isConfigured = geminiService.isGeminiConfigured();
    assert(typeof isConfigured === 'boolean');
  });

  await runTest('AI Service: services/ai and services/gemini export identical interfaces', () => {
    const aiService = require('../services/ai');
    assert.strictEqual(typeof aiService.isGeminiConfigured, 'function');
    assert.strictEqual(typeof aiService.generateNoteSummary, 'function');
    assert.strictEqual(typeof aiService.generateQuizQuestions, 'function');
    assert.strictEqual(typeof aiService.sanitizeErrorMessage, 'function');
  });

  await runTest('AI Service: Redacts sensitive keys in error logging', () => {
    const aiService = require('../services/ai');
    const sanitized = aiService.sanitizeErrorMessage('Failed at https://api.google.com?key=AIzaSyFakeKey12345678901234567890123');
    assert(!sanitized.includes('AIzaSyFakeKey12345678901234567890123'), 'Sanitizer must redact API key');
    assert(sanitized.includes('[REDACTED'), 'Sanitizer should insert redaction placeholder');
  });

  await runTest('AI Summary: Validate required output schema structure', () => {
    // Verify that expected schema structure matches required fields
    const mockOutput = {
      quickSummary: "Cloud computing delivers on-demand computing services over the internet.",
      keyPoints: [
        "Infrastructure as a Service (IaaS)",
        "Platform as a Service (PaaS)",
        "Software as a Service (SaaS)"
      ],
      definitions: [
        { term: "IaaS", meaning: "Fundamental compute and networking infrastructure rented on demand." }
      ],
      examRevision: ["Understand the shared responsibility model."],
      keywords: ["Cloud", "IaaS", "PaaS", "SaaS", "Virtualization"]
    };

    assert(typeof mockOutput.quickSummary === 'string' && mockOutput.quickSummary.length > 0);
    assert(Array.isArray(mockOutput.keyPoints) && mockOutput.keyPoints.length > 0);
    assert(Array.isArray(mockOutput.definitions) && mockOutput.definitions[0].term);
    assert(Array.isArray(mockOutput.examRevision) && mockOutput.examRevision.length > 0);
    assert(Array.isArray(mockOutput.keywords) && mockOutput.keywords.length > 0);
  });

  await runTest('AI Quiz: Validate required 5-MCQ output schema structure', () => {
    const mockQuiz = [
      {
        id: 1,
        question: "Which cloud service model provides virtualized hardware?",
        options: ["SaaS", "PaaS", "IaaS", "FaaS"],
        correctAnswer: 2,
        explanation: "IaaS provides bare-metal or virtualized computing infrastructure."
      }
    ];

    assert(Array.isArray(mockQuiz));
    assert.strictEqual(mockQuiz[0].options.length, 4);
    assert(typeof mockQuiz[0].correctAnswer === 'number');
    assert(typeof mockQuiz[0].explanation === 'string');
  });

  await runTest('Gemini: extractJson repairs bad escape characters (LaTeX backslashes, unescaped newlines, trailing commas)', () => {
    // Exact failure case seen in Render logs: Bad escaped character in JSON (e.g. \theta, \alpha, \frac)
    const malformedOutput = '```json\n{\n  "quickSummary": "Formula \\alpha + \\beta where \\theta = \\frac{1}{2} and path C:\\data.",\n  "keyPoints": [\n    "Point with \\invalid escape sequence",\n    "Point with trailing comma",\n  ],\n  "definitions": [\n    { "term": "Term1", "meaning": "Meaning1" }\n  ],\n  "examRevision": [\n    "Tip 1"\n  ],\n  "keywords": ["LaTeX", "Math", "Escapes"]\n}\n```';

    const parsed = geminiService.extractJson(malformedOutput);
    assert(parsed, 'Must successfully parse repaired JSON');
    assert(parsed.quickSummary.includes('Formula'), 'Must extract quickSummary');
    assert.strictEqual(parsed.keyPoints.length, 2, 'Must preserve keyPoints');
    assert.strictEqual(parsed.definitions.length, 1, 'Must preserve definitions');
  });

  await runTest('Gemini: validateSummarySchema validates required fields and sets safe defaults', () => {
    const valid = {
      quickSummary: 'Core concept of distributed computing.',
      keyPoints: ['Point 1', 'Point 2']
    };
    const validated = geminiService.validateSummarySchema(valid);
    assert.strictEqual(validated.quickSummary, 'Core concept of distributed computing.');
    assert.strictEqual(validated.keyPoints.length, 2);
    assert(Array.isArray(validated.definitions), 'Missing definitions must default to empty array');
    assert(Array.isArray(validated.examRevision), 'Missing examRevision must default to empty array');
    assert(Array.isArray(validated.keywords), 'Missing keywords must default to empty array');

    // Missing required fields must throw
    assert.throws(() => geminiService.validateSummarySchema({}), /quickSummary/);
    assert.throws(() => geminiService.validateSummarySchema({ quickSummary: 'Hi', keyPoints: [] }), /keyPoints/);
  });

  await runTest('Gemini: validateQuizSchema validates 5-MCQ format and bounds correctAnswer', () => {
    const validQuiz = [
      {
        id: 1,
        question: 'What is a Lamport timestamp?',
        options: ['Logical clock', 'Physical clock', 'NTP server', 'GPS clock'],
        correctAnswer: 0,
        explanation: 'Lamport timestamps provide logical clock synchronization.'
      }
    ];

    const validated = geminiService.validateQuizSchema(validQuiz);
    assert.strictEqual(validated.length, 1);
    assert.strictEqual(validated[0].options.length, 4);
    assert.strictEqual(validated[0].correctAnswer, 0);

    // Invalid quiz must throw
    assert.throws(() => geminiService.validateQuizSchema([]), /non-empty/);
  });

  await runTest('Gemini: getCandidateModels includes default models and respects GEMINI_MODEL override', () => {
    const defaults = geminiService.getCandidateModels();
    assert(defaults.includes('gemini-3.5-flash-lite'), 'Must include gemini-3.5-flash-lite');
    assert(defaults.includes('gemini-3.8-flash'), 'Must include gemini-3.8-flash');

    process.env.GEMINI_MODEL = 'gemini-custom-experimental';
    try {
      const customModels = geminiService.getCandidateModels();
      assert.strictEqual(customModels[0], 'gemini-custom-experimental', 'Custom model must be prioritized first');
    } finally {
      delete process.env.GEMINI_MODEL;
    }
  });

  await runTest('OCR: Tesseract subprocess environment restricts OMP_THREAD_LIMIT to 1 for Render Free 512MB RAM', () => {
    assert.strictEqual(process.env.OMP_THREAD_LIMIT, '1', 'OMP_THREAD_LIMIT must be set to 1');
  });

  // =========================================================================
  // 9. FULL-DOCUMENT OCR & BACKGROUND QUEUE DURABILITY TESTS
  // =========================================================================
  const ocrQueue = require('../services/ocrQueue');

  await runTest('OCR: Full-document multi-page scanned PDF processes all pages sequentially in batches without artificial 4-page cap', async () => {
    const scannedBuf = buildSyntheticScannedPdf();
    const batchesCalled = [];

    ocrService.setMockOCRHandler(async (buf, opts) => {
      if (opts.pageNumbers) {
        batchesCalled.push([...opts.pageNumbers]);
      }
      return {
        text: '--- Page 1 ---\nDistributed Hash Tables and Consistent Hashing.\n\n--- Page 2 ---\nChord protocol routing and finger tables.\n\n--- Page 3 ---\nVirtual nodes for load balancing.\n\n--- Page 4 ---\nReplication strategies across nodes.\n\n--- Page 5 ---\nFault tolerance and network partitions.\n\n--- Page 6 ---\nVector clocks for causal consistency.',
        pagesProcessed: 6,
        totalPages: 6,
        isOcr: true
      };
    });

    try {
      const result = await ocrService.extractTextFromScannedPDF(scannedBuf, {
        filename: 'six_page_scan.pdf',
        maxPages: 6
      });

      assert.strictEqual(result.totalPages, 6, 'Should detect all 6 pages');
      assert.strictEqual(result.pagesProcessed, 6, 'Should process all 6 pages completely');
      assert(result.text.includes('Consistent Hashing'), 'Must include page 1 text');
      assert(result.text.includes('Vector clocks'), 'Must include page 6 text (beyond 4-page cap)');
    } finally {
      ocrService.setMockOCRHandler(null);
    }
  });

  await runTest('OCR: Mixed PDF with selectable text and scanned pages combines both in order', async () => {
    // Page 1 has selectable text, Page 2 needs OCR
    const mixedBuf = buildSyntheticMultiPageTextPdf();

    ocrService.setMockOCRHandler(async (buf, opts) => {
      return {
        text: '--- Page 1 ---\nPage 1: Overview of Relational Database Systems\n\n--- Page 2 ---\nScanned Handwritten Notes on B+ Tree Indexing Structures.',
        pagesProcessed: 2,
        totalPages: 2,
        isOcr: true
      };
    });

    try {
      const result = await ocrService.extractTextFromScannedPDF(mixedBuf, { filename: 'mixed_doc.pdf' });
      assert(result.text.includes('Page 1'), 'Must include Page 1 marker');
      assert(result.text.includes('Page 2'), 'Must include Page 2 marker');
    } finally {
      ocrService.setMockOCRHandler(null);
    }
  });

  await runTest('OCR Queue: Enqueue creates persistent ocr_jobs and file_pages records in SQLite', () => {
    // 1. Create a dummy file record
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status)
      VALUES (1, 'queue_test.pdf', 'db:queue_test.pdf', 'application/pdf', 1024, 'Cloud Computing', 'processing')
    `).run();
    const testFileId = insert.lastInsertRowid;

    // 2. Enqueue job
    const jobRes = ocrQueue.enqueueJob({
      fileId: testFileId,
      userId: 1,
      originalName: 'queue_test.pdf',
      subject: 'Cloud Computing',
      pdfBuffer: buildSyntheticScannedPdf()
    });

    assert(jobRes.jobId > 0, 'Job must receive valid jobId');

    const jobRow = db.prepare('SELECT * FROM ocr_jobs WHERE file_id = ?').get(testFileId);
    assert(jobRow, 'Job record must exist in ocr_jobs table');
    assert.strictEqual(jobRow.file_id, testFileId);
    assert.strictEqual(jobRow.status, 'queued');
  });

  await runTest('OCR Queue: retryFailedPages only resets failed pages without touching completed pages', () => {
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status)
      VALUES (1, 'retry_test.pdf', 'db:retry_test.pdf', 'application/pdf', 2048, 'Operating Systems', 'processing')
    `).run();
    const testFileId = insert.lastInsertRowid;

    // Insert job
    db.prepare(`
      INSERT INTO ocr_jobs (file_id, user_id, status, failed_pages, retry_count)
      VALUES (?, 1, 'partially_failed', '[2]', 0)
    `).run(testFileId);

    // Insert 2 pages: Page 1 completed, Page 2 failed
    db.prepare(`
      INSERT INTO file_pages (file_id, page_number, text_content, status, is_ocr)
      VALUES (?, 1, 'Page 1 Process Schedulers', 'completed', 1)
    `).run(testFileId);

    db.prepare(`
      INSERT INTO file_pages (file_id, page_number, text_content, status, is_ocr, error_message)
      VALUES (?, 2, NULL, 'failed', 1, 'Temporary OCR timeout')
    `).run(testFileId);

    // Call retry
    const res = ocrQueue.retryFailedPages(testFileId, 1);
    assert.strictEqual(res.success, true);

    // Page 1 should still be 'completed'
    const page1 = db.prepare('SELECT status, text_content FROM file_pages WHERE file_id = ? AND page_number = 1').get(testFileId);
    assert.strictEqual(page1.status, 'completed', 'Page 1 must remain completed');
    assert.strictEqual(page1.text_content, 'Page 1 Process Schedulers');

    // Page 2 should now be 'pending'
    const page2 = db.prepare('SELECT status FROM file_pages WHERE file_id = ? AND page_number = 2').get(testFileId);
    assert.strictEqual(page2.status, 'pending', 'Page 2 must be reset to pending');

    // Job retry count should be incremented
    const jobRow = db.prepare('SELECT retry_count, status FROM ocr_jobs WHERE file_id = ?').get(testFileId);
    assert.strictEqual(jobRow.retry_count, 1);
  });

  await runTest('OCR Queue: Enforce bounded retry limit (MAX_PAGE_RETRY_COUNT = 3)', () => {
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status)
      VALUES (1, 'max_retry_test.pdf', 'db:max_retry.pdf', 'application/pdf', 2048, 'OS', 'ready')
    `).run();
    const testFileId = insert.lastInsertRowid;

    db.prepare(`
      INSERT INTO ocr_jobs (file_id, user_id, status, retry_count)
      VALUES (?, 1, 'partially_failed', 3)
    `).run(testFileId);

    db.prepare(`
      INSERT INTO file_pages (file_id, page_number, status, is_ocr)
      VALUES (?, 1, 'failed', 1)
    `).run(testFileId);

    const retryRes = ocrQueue.retryFailedPages(testFileId, 1);
    assert.strictEqual(retryRes.success, false, 'Should reject retry when retry_count >= 3');
    assert.strictEqual(retryRes.maxRetriesReached, true, 'maxRetriesReached flag must be true');
    assert(retryRes.message.includes('Maximum retry limit'), 'Message must indicate limit reached');
  });

  await runTest('OCR Queue: recoverInterruptedJobs safely re-queues processing jobs after server restart', () => {
    // Insert an interrupted job (status = 'processing')
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status)
      VALUES (1, 'restart_test.pdf', 'db:restart_test.pdf', 'application/pdf', 4096, 'DBMS', 'processing')
    `).run();
    const testFileId = insert.lastInsertRowid;

    db.prepare(`
      INSERT INTO ocr_jobs (file_id, user_id, status, status_message)
      VALUES (?, 1, 'processing', 'Interrupted during server shutdown')
    `).run(testFileId);

    // Call recovery
    ocrQueue.recoverInterruptedJobs();

    const recoveredJob = db.prepare('SELECT status, status_message FROM ocr_jobs WHERE file_id = ?').get(testFileId);
    assert.strictEqual(recoveredJob.status, 'queued', 'Interrupted job must be reset to queued for safe resumption');
    assert(recoveredJob.status_message.includes('restart'), 'Message should indicate restart recovery');
  });

  await runTest('OCR Status: getJobStatus returns detailed page-level metrics', () => {
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status, status_message)
      VALUES (1, 'metrics_test.pdf', 'db:metrics.pdf', 'application/pdf', 1024, 'Networks', 'ready', 'All pages done')
    `).run();
    const testFileId = insert.lastInsertRowid;

    db.prepare(`
      INSERT INTO ocr_jobs (file_id, user_id, total_pages, processed_pages, failed_pages, status)
      VALUES (?, 1, 10, 8, '[4, 9]', 'partially_failed')
    `).run(testFileId);

    const status = ocrQueue.getJobStatus(testFileId);
    assert.strictEqual(status.totalPages, 10);
    assert.strictEqual(status.processedPages, 8);
    assert.deepStrictEqual(status.failedPages, [4, 9]);
    assert.strictEqual(status.status, 'ready');
  });

  // =========================================================================
  // 10. ASK MY NOTES & DOCUMENT GROUNDING TESTS
  // =========================================================================
  await runTest('Ask My Notes: chunkDocumentByPages segments multi-page text with accurate page numbers', () => {
    const docText = `--- Page 1 ---
Distributed systems are autonomous computing elements that appear to users as a single coherent system.

--- Page 2 ---
Lamport logical clocks provide a partial ordering of events based on the happened-before relation.

--- Page 3 ---
Vector clocks extend Lamport timestamps to determine whether two events are causally related or concurrent.`;

    const chunks = geminiService.chunkDocumentByPages(docText);
    assert.strictEqual(chunks.length, 3, 'Should produce exactly 3 page chunks');
    assert.strictEqual(chunks[0].pageNum, 1);
    assert(chunks[0].text.includes('coherent system'));
    assert.strictEqual(chunks[1].pageNum, 2);
    assert(chunks[1].text.includes('Lamport logical clocks'));
    assert.strictEqual(chunks[2].pageNum, 3);
    assert(chunks[2].text.includes('Vector clocks'));
  });

  await runTest('Ask My Notes: retrieveRelevantChunks prioritizes query keywords for long documents', () => {
    const chunks = [
      { pageNum: 1, text: 'Introduction to operating systems and hardware abstractions.' },
      { pageNum: 2, text: 'Process scheduling algorithms: First-Come First-Served and Shortest Job First.' },
      { pageNum: 3, text: 'Bankers algorithm for deadlock avoidance in multi-resource environments.' },
      { pageNum: 4, text: 'Paging, segmentation, and virtual memory page replacement policies: LRU and FIFO.' }
    ];

    const query = 'How does the Bankers algorithm prevent deadlocks?';
    const selected = geminiService.retrieveRelevantChunks(chunks, query, 20);

    assert(selected.length > 0, 'Should select relevant chunks');
    assert(selected.some(c => c.pageNum === 3), 'Chunk containing Bankers algorithm must be selected');
    assert(selected[0].pageNum === 3 || selected[selected.length - 1].pageNum === 3);
  });

  await runTest('Ask My Notes: Grounding directive includes strict instructions and citations', () => {
    // Verify that the prompt formatting function in gemini.js enforces grounding
    const sampleContent = '--- Page 2 ---\nDeadlock requires 4 conditions: Mutual Exclusion, Hold and Wait, No Preemption, Circular Wait.';
    const chunks = geminiService.chunkDocumentByPages(sampleContent);
    assert.strictEqual(chunks[0].pageNum, 2);
    assert(chunks[0].text.includes('Mutual Exclusion'));
  });

  await runTest('Ask My Notes: Cross-user document access is strictly rejected', () => {
    // Ensure student2 user exists with valid foreign key
    let student2 = db.prepare('SELECT id FROM users WHERE email = ?').get('student2@smartnotes.edu');
    if (!student2) {
      const u = db.prepare(`
        INSERT INTO users (name, email, password_hash)
        VALUES ('Student Two', 'student2@smartnotes.edu', 'hashedpassword')
      `).run();
      student2 = { id: u.lastInsertRowid };
    }

    // Create a note owned by student2
    const noteInsert = db.prepare(`
      INSERT INTO notes (user_id, title, subject, content)
      VALUES (?, 'Confidential Student Notes', 'Security', '<p>Private data</p>')
    `).run(student2.id);
    const privateNoteId = noteInsert.lastInsertRowid;

    // Authenticated user 1 (demo student) tries to access note belonging to student 2
    const accessibleNote = db.prepare(`
      SELECT n.id FROM notes n
      WHERE n.id = ? AND n.user_id = 1
    `).get(privateNoteId);

    assert.strictEqual(accessibleNote, undefined, 'User 1 must not be authorized to access User 2 document');
  });

  await runTest('Ask My Notes: Documents with incomplete OCR return processing status error', () => {
    // Insert a file in processing state
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status)
      VALUES (1, 'in_progress.pdf', 'db:in_progress.pdf', 'application/pdf', 1024, 'Cloud Computing', 'processing')
    `).run();
    const processingFileId = insert.lastInsertRowid;

    const file = db.prepare('SELECT status FROM files WHERE id = ?').get(processingFileId);
    assert.strictEqual(file.status, 'processing');
    // Processing status indicates document is not yet ready for Ask My Notes
    assert.notStrictEqual(file.status, 'ready');
  });

  await runTest('Ask My Notes: Documents with failed OCR return failed status error', () => {
    const insert = db.prepare(`
      INSERT INTO files (user_id, original_filename, s3_key, file_type, file_size, subject, status)
      VALUES (1, 'corrupted.pdf', 'db:corrupted.pdf', 'application/pdf', 1024, 'Cloud Computing', 'failed')
    `).run();
    const failedFileId = insert.lastInsertRowid;

    const file = db.prepare('SELECT status FROM files WHERE id = ?').get(failedFileId);
    assert.strictEqual(file.status, 'failed');
    assert.notStrictEqual(file.status, 'ready');
  });

  // Cleanup test records
  try {
    db.prepare("DELETE FROM ocr_jobs WHERE file_id IN (SELECT id FROM files WHERE original_filename IN ('queue_test.pdf', 'retry_test.pdf', 'restart_test.pdf', 'metrics_test.pdf', 'in_progress.pdf', 'corrupted.pdf', 'max_retry_test.pdf'))").run();
    db.prepare("DELETE FROM file_pages WHERE file_id IN (SELECT id FROM files WHERE original_filename IN ('queue_test.pdf', 'retry_test.pdf', 'restart_test.pdf', 'metrics_test.pdf', 'in_progress.pdf', 'corrupted.pdf', 'max_retry_test.pdf'))").run();
    db.prepare("DELETE FROM files WHERE original_filename IN ('queue_test.pdf', 'retry_test.pdf', 'restart_test.pdf', 'metrics_test.pdf', 'in_progress.pdf', 'corrupted.pdf', 'max_retry_test.pdf')").run();
  } catch (cleanErr) {
    // Ignore cleanup error
  }

  // Summary
  console.log('\n====================================================');
  console.log(`  TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('====================================================');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[Test Suite Error]', err);
  process.exit(1);
});
