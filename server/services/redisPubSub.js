const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Pub/sub needs a dedicated connection per role — a subscriber connection
// can't also be used to publish or run other commands. Each caller gets its
// own pair rather than sharing the BullMQ queue's connection.
function createPublisher() {
  const client = new IORedis(REDIS_URL);
  client.on('error', (err) => console.error('[redis:pub] connection error:', err.message));
  return client;
}

function createSubscriber() {
  const client = new IORedis(REDIS_URL);
  client.on('error', (err) => console.error('[redis:sub] connection error:', err.message));
  return client;
}

module.exports = { createPublisher, createSubscriber };
