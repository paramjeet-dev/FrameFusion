# Shared image for both the API (server.js) and the worker (worker.js) —
# they're separate processes/containers but the same codebase and deps.
#
# IMPORTANT: this must stay Debian-based (slim), not Alpine.
# @ffmpeg-installer/ffmpeg and @ffprobe-installer/ffprobe download prebuilt
# glibc-linked binaries on `npm install` — they will fail to execute on
# Alpine's musl libc.
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Matches the dirs server.js/worker.js create at boot via fs.mkdirSync —
# created here too so the mount points exist even before the app runs.
RUN mkdir -p uploads/chunks processed

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# docker-compose overrides this with `node worker.js` for the worker service.
CMD ["node", "server.js"]
