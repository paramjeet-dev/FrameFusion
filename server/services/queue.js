const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // required by BullMQ
});

connection.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

const videoQueue = new Queue('video-processing', { connection });

module.exports = { videoQueue, connection };
