# SmartNotes - Docker Containerization
# Base Image: Lightweight Node.js 20 LTS Alpine with build tools for native SQLite
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Install python and build tools needed for native node modules
RUN apk add --no-cache python3 make g++

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Ensure database directory exists
RUN mkdir -p database uploads

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose server port
EXPOSE 3000

# Health check to ensure server responds
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start SmartNotes server
CMD ["node", "server.js"]
