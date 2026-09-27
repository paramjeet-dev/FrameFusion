# Multi-stage build: compile the Vite app, then serve the static output
# through nginx (which also reverse-proxies /api and /socket.io/ to the
# backend container so the client's same-origin socket.js code works
# unmodified in production).
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
