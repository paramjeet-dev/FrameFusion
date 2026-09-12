import { io } from 'socket.io-client';

// In dev, Vite serves the app on :5173 and the API on :5000 — the /api
// proxy in vite.config.js only covers HTTP, not the WebSocket upgrade, so
// the socket connects directly to the API port. In production these are
// typically the same origin, so passing no URL falls back to same-origin.
const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:5000' : undefined;

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
});
