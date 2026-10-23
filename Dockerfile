# SmartNotes - Docker Containerization
# Base Image: Official Node.js 22 LTS Bookworm Slim (glibc)
# Using Debian glibc prevents segmentation faults (exit code 139) caused by musl libc on Alpine
FROM node:22-bookworm-slim

# Set working directory inside container
WORKDIR /app

# Install build tools and OCR system dependencies:
# - python3, make, g++: for compiling native C++ addons (better-sqlite3)
# - tesseract-ocr, tesseract-ocr-eng, tesseract-ocr-osd: native OCR engine with English & orientation detection
# - poppler-utils: pdftoppm / pdfinfo for ultra-fast, low-memory PDF-to-image conversion
# - debianutils: provides which command and Linux utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-osd \
    poppler-utils \
    debianutils \
    && rm -rf /var/lib/apt/lists/*

# Ensure tessdata directory paths are fully compatible across Debian versions
RUN mkdir -p /usr/share/tessdata /usr/share/tesseract-ocr/5/tessdata && \
    for f in /usr/share/tesseract-ocr/5/tessdata/*; do [ -e "$f" ] && ln -sf "$f" /usr/share/tessdata/ 2>/dev/null; done || true

# Copy package descriptors
COPY package*.json ./

# Install production dependencies and compile native SQLite bindings, then purge build compilers
RUN npm ci --omit=dev && npm rebuild better-sqlite3 \
    && apt-get purge -y make g++ && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy application source code
COPY . .

# Ensure bundled eng.traineddata is available in system tessdata paths as well
RUN if [ -f eng.traineddata ]; then \
      cp eng.traineddata /usr/share/tesseract-ocr/5/tessdata/eng.traineddata && \
      cp eng.traineddata /usr/share/tessdata/eng.traineddata; \
    fi

# Ensure database and uploads directories exist
RUN mkdir -p database uploads

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5
ENV OMP_THREAD_LIMIT=1

# Expose default application port
EXPOSE 3000

# Health check to ensure server responds (dynamically uses PORT, WEBSITES_PORT, or fallback 3000)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const port = process.env.PORT || process.env.WEBSITES_PORT || 3000; fetch('http://localhost:' + port + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start SmartNotes server
CMD ["node", "server.js"]

