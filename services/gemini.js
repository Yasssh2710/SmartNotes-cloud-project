/**
 * SmartNotes - Google Gemini AI Service (services/gemini.js)
 * Uses the official @google/genai SDK to generate note summaries and MCQs.
 * Handles missing API key, quote sanitation, and model fallbacks gracefully without crashing.
 */

const fs = require('fs');
const path = require('path');
// Explicitly load .env with absolute path to ensure environment variables are present
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { GoogleGenAI } = require('@google/genai');

// High-speed, high-availability Gemini models with automated fallback
const GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite'
];

/**
 * Retrieves and sanitizes the Gemini API key from environment variables.
 * Automatically checks process.env.GEMINI_API_KEY and re-reads .env if needed.
 * @returns {string|null}
 */
function getApiKey() {
  let key = process.env.GEMINI_API_KEY;

  // If not found in process.env, reload .env from disk with override to support hot updates
  if (!key || !key.trim()) {
    try {
      const envPath = path.join(__dirname, '..', '.env');
      if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath, override: true });
        key = process.env.GEMINI_API_KEY;
      }
    } catch (_) {}
  }

  if (!key || typeof key !== 'string') return null;

  // Clean whitespace, carriage returns, and wrapping quotes
  key = key.trim().replace(/^["']|["']$/g, '').trim();

  // Guard against common placeholder values or empty string
  const placeholders = [
    'your_gemini_api_key_here',
    'your_gemini_key',
    'your_api_key_here',
    'AIzaSyYourActualGeminiKeyHere',
    'YOUR_API_KEY'
  ];

  if (!key || placeholders.includes(key) || key.length < 8) {
    return null;
  }

  return key;
}

/**
 * Checks if Gemini API is configured with a valid key
 * @returns {boolean}
 */
function isGeminiConfigured() {
  return !!getApiKey();
}

/**
 * Safely sanitizes error messages to remove any API keys or secrets
 * @param {string|Error} err
 * @returns {string}
 */
function sanitizeErrorMessage(err) {
  if (!err) return 'Unknown error';
  let message = typeof err === 'string' ? err : (err.message || String(err));
  const activeKey = getApiKey();
  if (activeKey) {
    message = message.split(activeKey).join('[REDACTED_KEY]');
  }
  // Mask any potential key patterns in query strings, headers, or URLs
  message = message.replace(/(?:key|apiKey|api_key)=([^&\s]+)/gi, 'key=[REDACTED]');
  message = message.replace(/AIzaSy[A-Za-z0-9_-]{33}/g, '[REDACTED_KEY]');
  message = message.replace(/AQ\.[A-Za-z0-9_-]{40,}/g, '[REDACTED_KEY]');
  return message;
}

/**
 * Logs structured Gemini error details without exposing sensitive credentials
 * @param {string} operation
 * @param {string} model
 * @param {Error} err
 */
function logGeminiError(operation, model, err) {
  const sanitizedMsg = sanitizeErrorMessage(err);
  const status = err.status || err.statusCode || (err.error && err.error.code) || 'N/A';
  const errorType = err.name || 'GeminiError';

  let category = 'Generation Error';
  if (status === 401 || status === 403 || /unauthenticated|permission_denied|api key/i.test(sanitizedMsg)) {
    category = 'Authentication / Invalid API Key';
  } else if (status === 429 || /resource_exhausted|quota|rate limit/i.test(sanitizedMsg)) {
    category = 'Quota Exceeded / Rate Limit';
  } else if (status === 404 || /not_found|model.*not found/i.test(sanitizedMsg)) {
    category = 'Model Not Found';
  } else if (status === 400 || /invalid_argument/i.test(sanitizedMsg)) {
    category = 'Bad Request / Invalid Argument';
  } else if (/enotfound|econnrefused|etimedout|fetch failed/i.test(sanitizedMsg)) {
    category = 'Network Connection Issue';
  }

  console.warn(`[Gemini][${operation}] Model "${model}" failed | Type: ${errorType} | Category: ${category} | Status: ${status} | Detail: ${sanitizedMsg}`);
}

/**
 * Helper to safely extract and parse JSON from AI response
 * @param {string} responseText
 * @returns {any}
 */
function extractJson(responseText) {
  if (!responseText) throw new Error('Empty response from AI model');
  let cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw parseErr;
  }
}

/**
 * Instantiates the official Google GenAI client
 * @returns {GoogleGenAI|null}
 */
function getGeminiClient() {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

/**
 * Generates an AI summary for study note content
 * @param {string} title - Note Title
 * @param {string} content - Note Content
 * @returns {Promise<Object>}
 */
async function generateNoteSummary(title, content) {
  if (!isGeminiConfigured()) {
    const error = new Error('AI features are not configured yet (Set GEMINI_API_KEY in .env).');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }

  const ai = getGeminiClient();
  const cleanContent = (content || '').replace(/<[^>]*>/g, ' ').substring(0, 35000);
  const prompt = `You are an academic study assistant for engineering college students.
Summarize the following study note into clear, concise, structured revision materials.
(Note: If the document was extracted via OCR from scanned textbook pages or handouts, ignore OCR noise/page markers and summarize the substantive academic concepts.)

Note Title: ${title || 'Study Note'}
Note Content:
${cleanContent}

You must return a valid JSON object with EXACTLY the following structure (do not include markdown ticks \`\`\`json around it, just raw JSON):
{
  "quickSummary": "2-3 dense sentences explaining the core concept.",
  "keyPoints": [
    "Key takeaway point 1",
    "Key takeaway point 2",
    "Key takeaway point 3",
    "Key takeaway point 4"
  ],
  "definitions": [
    { "term": "Term Name", "meaning": "Precise academic definition" },
    { "term": "Second Term", "meaning": "Precise definition" }
  ],
  "examRevision": [
    "Exam tip 1",
    "Exam tip 2",
    "Exam tip 3"
  ],
  "keywords": ["Keyword1", "Keyword2", "Keyword3", "Keyword4", "Keyword5"]
}
Only summarize information contained in the provided note. Do not invent or fabricate outside facts. Keep language simple and academic.`;

  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const parsed = extractJson(response.text || '');

      if (!parsed.quickSummary || !Array.isArray(parsed.keyPoints)) {
        throw new Error('AI summary response missing expected fields');
      }

      return parsed;
    } catch (err) {
      lastError = err;
      logGeminiError('Summary', model, err);
    }
  }

  const safeMsg = sanitizeErrorMessage(lastError);
  console.error(`[Gemini][Summary] All fallback models failed. Last error: ${safeMsg}`);
  throw new Error(`Failed to generate AI summary: ${safeMsg}`);
}

/**
 * Generates a 5-question multiple choice revision quiz based on note content
 * @param {string} title - Note Title
 * @param {string} content - Note Content
 * @returns {Promise<Array>}
 */
async function generateQuizQuestions(title, content) {
  if (!isGeminiConfigured()) {
    const error = new Error('AI features are not configured yet (Set GEMINI_API_KEY in .env).');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }

  const ai = getGeminiClient();
  const cleanContent = (content || '').replace(/<[^>]*>/g, ' ').substring(0, 35000);
  const prompt = `You are an academic exam coordinator for college students.
Generate a 5-question multiple choice revision quiz based solely on this study note.
(Note: If the document was extracted via OCR from scanned materials, base all questions strictly on the actual factual content extracted from the document.)

Note Title: ${title || 'Study Note'}
Note Content:
${cleanContent}

Return a valid JSON array of EXACTLY 5 questions (no markdown ticks \`\`\`json, just raw JSON):
[
  {
    "id": 1,
    "question": "Clear academic question text",
    "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
    "correctAnswer": 0,
    "explanation": "Detailed explanation of why this answer is correct."
  }
]
Do not fabricate facts or questions outside the provided study note content.`;

  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const parsed = extractJson(response.text || '');

      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Invalid quiz format received from AI model.');
      }

      return parsed;
    } catch (err) {
      lastError = err;
      logGeminiError('Quiz', model, err);
    }
  }

  const safeMsg = sanitizeErrorMessage(lastError);
  console.error(`[Gemini][Quiz] All fallback models failed. Last error: ${safeMsg}`);
  throw new Error(`Failed to generate AI quiz: ${safeMsg}`);
}

module.exports = {
  isGeminiConfigured,
  isAIConfigured: isGeminiConfigured,
  generateNoteSummary,
  generateQuizQuestions,
  getApiKey,
  getGeminiClient,
  sanitizeErrorMessage,
  logGeminiError
};
