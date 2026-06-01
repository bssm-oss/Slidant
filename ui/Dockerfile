FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Docker 환경: nginx가 /api/* 를 BE로 프록시하므로 상대 경로 사용
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
# VITE_WS_URL은 wsClient.ts에서 location.host 기반 자동 생성

RUN pnpm build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
