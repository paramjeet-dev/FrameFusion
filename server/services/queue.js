const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const logger = require('./logger');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // required by BullMQ
});

connection.on('error', (err) => {
  logger.error({ err: err.message }, 'redis_queue_connection_error');
});

const videoQueue = new Queue('video-processing', { connection });

module.exports = { videoQueue, connection };
