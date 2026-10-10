/**
 * SmartNotes - Express Web Application Server (server.js)
 * Serves frontend static assets, manages sessions, and exposes REST APIs
 * for Authentication, Notes, S3 Document Storage, and Google Gemini AI.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const cors = require('cors');

// Ensure database is initialized
require('./database/db');

// Import route modules
const { router: authRouter } = require('./routes/auth');
const notesRouter = require('./routes/notes');
const filesRouter = require('./routes/files');
const aiRouter = require('./routes/ai');
const subjectsRouter = require('./routes/subjects');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'smartnotes_college_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/notes', notesRouter);
app.use('/api/files', filesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/subjects', subjectsRouter);

// Serve static frontend files from /public
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Health check endpoint for container and cloud deployments (e.g. Render)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Fallback for SPA/direct navigation to landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Centralized Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.stack || err.message);
  res.status(500).json({
    success: false,
    error: 'An internal server error occurred. Please try again later.'
  });
});

// Start Server
app.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log(`  SmartNotes Web Server is running!`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  Listening on: http://${HOST}:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('====================================================');
});
