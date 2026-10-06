const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { GoogleGenAI } = require('@google/genai');

const apiKey = (process.env.GEMINI_API_KEY || '').trim();
const ai = new GoogleGenAI({ apiKey });

async function run() {
  const prompt = `You are an academic study assistant for engineering college students.
Summarize the following study note into clear, concise, structured revision materials.

Note Title: AWS EC2 and S3 Basics
Note Content:
Amazon EC2 provides scalable computing capacity in the AWS cloud. It allows users to launch virtual servers with Amazon Machine Images (AMIs). Security Groups control traffic as a virtual firewall. Amazon S3 provides object storage where data is stored in buckets with 99.999999999% durability.

Return a valid JSON object with EXACTLY this structure (no markdown ticks):
{
  "quickSummary": "2-3 dense sentences explaining the core concept.",
  "keyPoints": ["Point 1", "Point 2", "Point 3", "Point 4"],
  "definitions": [
    { "term": "EC2", "meaning": "Elastic Compute Cloud" },
    { "term": "S3", "meaning": "Simple Storage Service" }
  ],
  "examRevision": ["Tip 1", "Tip 2", "Tip 3"],
  "keywords": ["AWS", "EC2", "S3", "Cloud", "Storage"]
}`;

  console.log('Sending prompt to gemini-3.5-flash-lite...');
  const res = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: prompt
  });

  const cleaned = res.text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  console.log('SUCCESS! Parsed JSON:');
  console.log(JSON.stringify(parsed, null, 2));
}

run().catch(err => {
  console.error('ERROR:', err.message);
});
