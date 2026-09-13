const { createPublisher, createSubscriber } = require('./redisPubSub');

const CHANNEL = 'framefusion:cancel-requests';

const publisher = createPublisher();
const subscriber = createSubscriber();
let subscribed = false;

/**
 * Called by the API process (jobController.cancelJob) to ask whichever
 * worker process is running the job to cancel it. This used to be a direct
 * function call into the worker's in-memory Map of active commands — that
 * only worked when API and worker shared a process. Now it's a message,
 * and the worker (services/worker.js) is what actually has the Map.
 */
function requestCancel(jobId) {
  publisher.publish(CHANNEL, jobId);
}

/**
 * Called by the worker process to learn about cancel requests.
 */
function onCancelRequested(handler) {
  if (!subscribed) {
    subscriber.subscribe(CHANNEL).catch((err) => {
      console.error('[cancelChannel] failed to subscribe:', err.message);
    });
    subscribed = true;
  }
  subscriber.on('message', (channel, message) => {
    if (channel === CHANNEL) handler(message);
  });
}

module.exports = { requestCancel, onCancelRequested };
