# Stage 1: build the React frontend
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: production server with the built frontend as static files
FROM node:22-slim
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=client-build /app/client/dist ./public

ENV DATA_DIR=/data \
    PORT=8090
VOLUME /data
EXPOSE 8090

CMD ["node", "src/index.js"]
