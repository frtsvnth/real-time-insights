FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# onnxruntime-node (Silero VAD) грузит нативный .so, собранный под glibc — на
# alpine (musl) это падает с ERR_DLOPEN_FAILED, поэтому тут debian-based slim,
# а не alpine.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 8000
CMD ["node", "dist/index.js"]
