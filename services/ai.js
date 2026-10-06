/**
 * SmartNotes - AI Service Module (services/ai.js)
 * Re-exports the unified Google Gemini AI service implementation
 * with explicit environment loading and seamless alias compatibility.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = require('./gemini');

