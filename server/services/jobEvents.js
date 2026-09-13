const { createPublisher, createSubscriber } = require('./redisPubSub');

const CHANNEL = 'framefusion:job-updates';

const publisher = createPublisher();
const subscriber = createSubscriber();
let subscribed = false;

/**
 * Called by the worker whenever a job's status or progress changes.
 */
function publish(payload) {
  publisher.publish(CHANNEL, JSON.stringify(payload));
}

/**
 * Called by the API process to receive job updates from the worker,
 * wherever it's running. Previously this was a plain Node EventEmitter,
 * which only worked because the worker and the socket server shared a
 * process — now that they can be split, this channel is what makes that
 * actually work instead of silently doing nothing across processes.
 */
function subscribe(handler) {
  if (!subscribed) {
    subscriber.subscribe(CHANNEL).catch((err) => {
      console.error('[jobEvents] failed to subscribe:', err.message);
    });
    subscribed = true;
  }
  subscriber.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;
    try {
      handler(JSON.parse(message));
    } catch (err) {
      console.error('[jobEvents] failed to parse message:', err.message);
    }
  });
}

module.exports = { publish, subscribe };
