const pino = require('pino');

// Plain structured JSON output — no pino-pretty transport, so there's no
// extra dependency required just to boot in production. For readable logs
// while developing locally, pipe through the pino-pretty CLI if you have it
// installed globally: `npm run dev | npx pino-pretty`.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'framefusion' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
