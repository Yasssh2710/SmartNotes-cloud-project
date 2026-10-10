/**
 * SmartNotes - Cloud & Database Storage Service (services/s3.js)
 * Integrates with AWS S3 using @aws-sdk/client-s3 when configured.
 * Implements a persistent SQLite database storage fallback for cloud environments
 * like Render where local container filesystem is ephemeral/temporary.
 */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');

// Ensure local uploads directory exists for disk caching / offline fallback
const localUploadsDir = path.join(__dirname, '..', 'uploads');
try {
  if (!fs.existsSync(localUploadsDir)) {
    fs.mkdirSync(localUploadsDir, { recursive: true });
  }
} catch (_) {}

function isS3Configured() {
  const region = (process.env.AWS_REGION || '').trim();
  const keyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secretKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.S3_BUCKET_NAME || '').trim();

  return Boolean(region && keyId && secretKey && bucket);
}

let s3Client = null;
if (isS3Configured()) {
  try {
    s3Client = new S3Client({
      region: process.env.AWS_REGION.trim(),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim()
      }
    });
    console.log('[Storage] Amazon S3 client initialized successfully.');
  } catch (err) {
    console.warn('[Storage] Warning initializing S3 client:', err.message);
  }
} else {
  console.log('[Storage] Amazon S3 is not configured. Using Database Storage fallback suitable for Render.');
}

/**
 * Uploads a file buffer or stream to S3 (or database persistent fallback)
 * @param {Object} file - Multer file object
 * @param {string|number} userId - User ID
 * @returns {Promise<{ s3Key: string, isS3: boolean, storageType: string }>}
 */
async function uploadFileToStorage(file, userId) {
  const timestamp = Date.now();
  const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');

  // Actual Amazon S3 Storage when configured
  if (isS3Configured() && s3Client) {
    const s3Key = `users/${userId}/notes/${timestamp}-${safeOriginalName}`;
    try {
      const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME.trim(),
        Key: s3Key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream'
      });
      await s3Client.send(command);
      console.log(`[Storage] Uploaded to Amazon S3 bucket ${process.env.S3_BUCKET_NAME.trim()}: ${s3Key}`);
      return { s3Key, isS3: true, storageType: 's3' };
    } catch (err) {
      console.error('[Storage] S3 upload error:', err.message);
      throw new Error(`S3 upload failed: ${err.message}`);
    }
  }

  // Persistent Database Storage Fallback (for Render & environments without S3)
  const dbKey = `db:${timestamp}-${safeOriginalName}`;

  // Also save a local disk copy for instant streaming if disk is writable
  try {
    const localFilePath = path.join(localUploadsDir, `${timestamp}-${safeOriginalName}`);
    fs.writeFileSync(localFilePath, file.buffer);
  } catch (fsErr) {
    console.warn('[Storage] Local disk cache notice:', fsErr.message);
  }

  console.log(`[Storage] Registered file with Database Storage fallback (S3 not configured): ${dbKey}`);
  return { s3Key: dbKey, isS3: false, storageType: 'database' };
}

/**
 * Retrieves a file from S3, database BLOB, or local disk storage
 * @param {string} s3Key - S3 Object Key or db: / local: key
 * @param {Object|null} fileRecord - Optional DB file record containing file_data BLOB
 * @returns {Promise<{ stream: Readable|ReadableStream, contentType: string }>}
 */
async function getFileFromStorage(s3Key, fileRecord = null) {
  const key = s3Key || '';

  // 1. Database Storage Fallback (db: or local:)
  if (key.startsWith('db:') || key.startsWith('local:')) {
    // If fileRecord with file_data is already available, stream directly from DB BLOB
    if (fileRecord && fileRecord.file_data) {
      return {
        stream: Readable.from(Buffer.from(fileRecord.file_data)),
        contentType: fileRecord.file_type || 'application/octet-stream'
      };
    }

    // Try reading cached file from local disk if it exists
    const filename = key.replace(/^db:|^local:/, '');
    const localFilePath = path.join(localUploadsDir, filename);
    if (fs.existsSync(localFilePath)) {
      return {
        stream: fs.createReadStream(localFilePath),
        contentType: (fileRecord && fileRecord.file_type) || 'application/octet-stream'
      };
    }

    // Otherwise fetch file_data from database
    try {
      const db = require('../database/db');
      const row = db.prepare('SELECT file_data, file_type FROM files WHERE s3_key = ?').get(key);
      if (row && row.file_data) {
        return {
          stream: Readable.from(Buffer.from(row.file_data)),
          contentType: row.file_type || (fileRecord && fileRecord.file_type) || 'application/octet-stream'
        };
      }
    } catch (dbErr) {
      console.warn('[Storage] DB retrieval warning:', dbErr.message);
    }

    throw new Error('File not found in database or local storage.');
  }

  // 2. Amazon S3 Storage
  if (isS3Configured() && s3Client) {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME.trim(),
      Key: key
    });
    const response = await s3Client.send(command);
    return {
      stream: response.Body,
      contentType: response.ContentType || (fileRecord && fileRecord.file_type) || 'application/octet-stream'
    };
  }

  // 3. Fallback if S3 key exists in DB record but S3 credentials are not configured
  if (fileRecord && fileRecord.file_data) {
    return {
      stream: Readable.from(Buffer.from(fileRecord.file_data)),
      contentType: fileRecord.file_type || 'application/octet-stream'
    };
  }

  throw new Error('Cloud storage (Amazon S3) is not configured on this server.');
}

/**
 * Deletes a file from S3 or local/database storage
 * @param {string} s3Key 
 */
async function deleteFileFromStorage(s3Key) {
  const key = s3Key || '';

  if (key.startsWith('db:') || key.startsWith('local:')) {
    const filename = key.replace(/^db:|^local:/, '');
    const localFilePath = path.join(localUploadsDir, filename);
    if (fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
      } catch (_) {}
    }
    return;
  }

  if (isS3Configured() && s3Client) {
    const command = new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME.trim(),
      Key: key
    });
    await s3Client.send(command);
    console.log(`[Storage] Deleted from Amazon S3: ${key}`);
  }
}

module.exports = {
  isS3Configured,
  uploadFileToStorage,
  getFileFromStorage,
  deleteFileFromStorage
};

