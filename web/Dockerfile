FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

ARG VITE_API_BASE_URL
ARG VITE_BASE_PATH
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_BASE_PATH=$VITE_BASE_PATH
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY serve.mjs ./
EXPOSE 8100
CMD ["node", "serve.mjs"]
