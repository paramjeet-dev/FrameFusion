const IORedis = require('ioredis');
const logger = require('./logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Pub/sub needs a dedicated connection per role — a subscriber connection
// can't also be used to publish or run other commands. Each caller gets its
// own pair rather than sharing the BullMQ queue's connection.
function createPublisher() {
  const client = new IORedis(REDIS_URL);
  client.on('error', (err) => logger.error({ err: err.message }, 'redis_pub_connection_error'));
  return client;
}

function createSubscriber() {
  const client = new IORedis(REDIS_URL);
  client.on('error', (err) => logger.error({ err: err.message }, 'redis_sub_connection_error'));
  return client;
}

module.exports = { createPublisher, createSubscriber };
