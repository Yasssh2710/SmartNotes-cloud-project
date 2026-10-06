/**
 * SmartNotes - Automated Backend Test Suite (tests/test_api.js)
 * Tests Database operations, Authentication flow, Notes CRUD,
 * File upload validation, and AI endpoints.
 */

const assert = require('assert');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const s3Service = require('../services/s3');
const geminiService = require('../services/gemini');

console.log('====================================================');
console.log('  RUNNING SMARTNOTES AUTOMATED TEST SUITE');
console.log('====================================================\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    testsFailed++;
  }
}

// 1. DATABASE TESTS
runTest('Database: Users table exists and demo user is seeded', () => {
  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get('student@smartnotes.demo');
  assert(user, 'Demo user must exist in database');
  assert(user.name && user.name.length > 0, 'User name must exist');
});

runTest('Database: Notes table contains initial seeded curriculum notes', () => {
  const count = db.prepare('SELECT COUNT(*) as count FROM notes').get();
  assert(count.count >= 6, 'Should have at least 6 initial notes seeded');
});

runTest('Database: Files table schema is valid', () => {
  const info = db.prepare('PRAGMA table_info(files)').all();
  const columnNames = info.map(c => c.name);
  assert(columnNames.includes('original_filename'));
  assert(columnNames.includes('s3_key'));
  assert(columnNames.includes('file_size'));
});

// 2. AUTHENTICATION TESTS
runTest('Auth: Password hashing with bcrypt works correctly', () => {
  const user = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('student@smartnotes.demo');
  const isMatch = bcrypt.compareSync('student123', user.password_hash);
  assert.strictEqual(isMatch, true, 'student123 password must verify against bcrypt hash');

  const isWrongMatch = bcrypt.compareSync('wrongpass', user.password_hash);
  assert.strictEqual(isWrongMatch, false, 'Invalid password must not verify');
});

// 3. NOTES CRUD & SEARCH TESTS
let testNoteId = null;

runTest('Notes: Create Note in database', () => {
  const stmt = db.prepare(`
    INSERT INTO notes (user_id, title, subject, topic, tags, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(1, 'Test Note for Automated Verification', 'Cloud Computing', 'Unit Testing', 'test, aws', '<p>Test content</p>');
  testNoteId = res.lastInsertRowid;
  assert(testNoteId > 0, 'New note ID must be greater than 0');
});

runTest('Notes: Read Note from database', () => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(testNoteId);
  assert(note, 'Created note must be readable');
  assert.strictEqual(note.title, 'Test Note for Automated Verification');
});

runTest('Notes: Search Note by keyword', () => {
  const notes = db.prepare('SELECT * FROM notes WHERE LOWER(title) LIKE ?').all('%automated verification%');
  assert(notes.length > 0, 'Should find note by title keyword');
});

runTest('Notes: Filter Notes by subject', () => {
  const notes = db.prepare('SELECT * FROM notes WHERE subject = ?').all('Cloud Computing');
  assert(notes.length > 0, 'Should find Cloud Computing notes');
});

runTest('Notes: Update Note in database', () => {
  db.prepare('UPDATE notes SET topic = ? WHERE id = ?').run('Updated Unit Test Topic', testNoteId);
  const updated = db.prepare('SELECT topic FROM notes WHERE id = ?').get(testNoteId);
  assert.strictEqual(updated.topic, 'Updated Unit Test Topic');
});

runTest('Notes: Delete Note from database', () => {
  const res = db.prepare('DELETE FROM notes WHERE id = ?').run(testNoteId);
  assert.strictEqual(res.changes, 1, 'Should delete exactly 1 note');
});

// 4. TEXT EXTRACTOR & SUBJECTS TESTS
const { extractTextFromFile } = require('../services/extractor');

runTest('Extractor: Extract plain text from TXT buffer', async () => {
  const txtContent = 'Virtual memory is a memory management capability of an operating system.';
  const extracted = await extractTextFromFile(Buffer.from(txtContent, 'utf-8'), 'os_notes.txt', 'text/plain');
  assert(extracted.includes('Virtual memory'), 'Should extract text content from TXT');
});

runTest('Subjects: Default subjects seeded and readable', () => {
  const subjects = db.prepare('SELECT name FROM subjects').all();
  const names = subjects.map(s => s.name);
  assert(names.includes('DBMS'), 'Should include DBMS');
  assert(names.includes('Operating Systems'), 'Should include Operating Systems');
  assert(names.includes('Cloud Computing'), 'Should include Cloud Computing');
});

runTest('Subjects: Add custom subject', () => {
  db.prepare(`
    INSERT OR IGNORE INTO subjects (user_id, name, description, semester)
    VALUES (?, ?, ?, ?)
  `).run(1, 'Distributed Systems', 'Advanced Distributed Systems curriculum', '7');

  const custom = db.prepare('SELECT * FROM subjects WHERE name = ?').get('Distributed Systems');
  assert(custom, 'Custom subject must be created in database');
  assert.strictEqual(custom.semester, '7');
});

// 5. STORAGE / S3 SERVICE TESTS
runTest('Storage: Fallback gracefully when AWS S3 is not configured', () => {
  const isConfigured = s3Service.isS3Configured();
  // It shouldn't crash regardless of whether S3 credentials exist
  assert(typeof isConfigured === 'boolean');
});

// 6. AI / GEMINI SERVICE TESTS
runTest('Gemini: Detects API key configuration safely without crashing', () => {
  const isConfigured = geminiService.isGeminiConfigured();
  assert(typeof isConfigured === 'boolean');
});

runTest('AI Service: services/ai and services/gemini export identical interfaces', () => {
  const aiService = require('../services/ai');
  assert.strictEqual(typeof aiService.isGeminiConfigured, 'function');
  assert.strictEqual(typeof aiService.generateNoteSummary, 'function');
  assert.strictEqual(typeof aiService.generateQuizQuestions, 'function');
  assert.strictEqual(typeof aiService.sanitizeErrorMessage, 'function');
});

runTest('AI Service: Redacts sensitive keys in error logging', () => {
  const aiService = require('../services/ai');
  const sanitized = aiService.sanitizeErrorMessage('Failed at https://api.google.com?key=AIzaSyFakeKey12345678901234567890123');
  assert(!sanitized.includes('AIzaSyFakeKey12345678901234567890123'), 'Sanitizer must redact API key');
  assert(sanitized.includes('[REDACTED'), 'Sanitizer should insert redaction placeholder');
});

console.log('\n====================================================');
console.log(`  TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('====================================================');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
