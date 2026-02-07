FROM node:22-slim

# Install Chromium dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set timezone to Eastern Time so ForexFactory displays times in ET
# (ForexFactory auto-detects browser timezone)
ENV TZ=America/New_York

WORKDIR /app

# Copy worker package files and install deps
COPY worker/package*.json ./worker/
WORKDIR /app/worker
RUN npm ci

# Copy worker source
WORKDIR /app
COPY worker/src ./worker/src
COPY worker/tsconfig.json ./worker/tsconfig.json

# Copy shared libraries needed by worker (relative imports: ../../lib, ../../convex)
COPY lib ./lib
COPY convex/_generated ./convex/_generated

# Run from worker directory
WORKDIR /app/worker
CMD ["npm", "start"]
