/**
 * SmartNotes - Amazon S3 Service (services/s3.js)
 * Integrates with AWS S3 using @aws-sdk/client-s3.
 * Handles graceful fallback if AWS credentials are not configured.
 */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Ensure local uploads directory exists for offline / local demo fallback
const localUploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(localUploadsDir)) {
  fs.mkdirSync(localUploadsDir, { recursive: true });
}

function isS3Configured() {
  return !!(
    process.env.AWS_REGION &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET_NAME
  );
}

let s3Client = null;
if (isS3Configured()) {
  try {
    s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
    console.log('[S3] Amazon S3 client initialized successfully.');
  } catch (err) {
    console.warn('[S3] Warning initializing S3 client:', err.message);
  }
} else {
  console.log('[S3] AWS credentials not configured. Using local filesystem storage for uploads.');
}

/**
 * Uploads a file buffer or stream to S3 (or local fallback)
 * @param {Object} file - Multer file object
 * @param {string} userId - User ID
 * @returns {Promise<{ s3Key: string, isS3: boolean }>}
 */
async function uploadFileToStorage(file, userId) {
  const timestamp = Date.now();
  const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
  const s3Key = `users/${userId}/notes/${timestamp}-${safeOriginalName}`;

  if (isS3Configured() && s3Client) {
    try {
      const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
        Body: file.buffer,
        ContentType: file.mimetype
      });
      await s3Client.send(command);
      console.log(`[S3] Uploaded to S3 bucket ${process.env.S3_BUCKET_NAME}: ${s3Key}`);
      return { s3Key, isS3: true };
    } catch (err) {
      console.error('[S3] S3 upload error:', err.message);
      throw new Error(`S3 upload failed: ${err.message}`);
    }
  }

  // Local storage fallback
  const localFilePath = path.join(localUploadsDir, `${timestamp}-${safeOriginalName}`);
  fs.writeFileSync(localFilePath, file.buffer);
  console.log(`[Storage] Saved locally: ${localFilePath}`);
  return { s3Key: `local:${timestamp}-${safeOriginalName}`, isS3: false };
}

/**
 * Retrieves a file from S3 or local storage for download
 * @param {string} s3Key - S3 Object Key or local key
 * @returns {Promise<{ stream: ReadableStream|Buffer, contentType: string }>}
 */
async function getFileFromStorage(s3Key) {
  if (s3Key.startsWith('local:')) {
    const filename = s3Key.replace('local:', '');
    const localFilePath = path.join(localUploadsDir, filename);
    if (!fs.existsSync(localFilePath)) {
      throw new Error('File not found in local storage.');
    }
    return {
      stream: fs.createReadStream(localFilePath),
      contentType: 'application/octet-stream'
    };
  }

  if (isS3Configured() && s3Client) {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key
    });
    const response = await s3Client.send(command);
    return {
      stream: response.Body,
      contentType: response.ContentType || 'application/octet-stream'
    };
  }

  throw new Error('Cloud storage is not configured yet.');
}

/**
 * Deletes a file from S3 or local storage
 * @param {string} s3Key 
 */
async function deleteFileFromStorage(s3Key) {
  if (s3Key.startsWith('local:')) {
    const filename = s3Key.replace('local:', '');
    const localFilePath = path.join(localUploadsDir, filename);
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
    return;
  }

  if (isS3Configured() && s3Client) {
    const command = new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key
    });
    await s3Client.send(command);
    console.log(`[S3] Deleted from S3: ${s3Key}`);
  }
}

module.exports = {
  isS3Configured,
  uploadFileToStorage,
  getFileFromStorage,
  deleteFileFromStorage
};
