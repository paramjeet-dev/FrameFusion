const { EventEmitter } = require('events');

// A plain Node EventEmitter, not a network bus — this only works because the
// worker and the socket.io server run in the same process. If the worker is
// ever split into its own process, this needs to become a Redis pub/sub
// channel instead (Redis is already a dependency via BullMQ, so that's a
// small change, not a new one).
module.exports = new EventEmitter();
