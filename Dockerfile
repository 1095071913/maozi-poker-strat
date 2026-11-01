# 德州扑克服务镜像
FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 再拷贝源码与静态资源
COPY server.js ./
COPY src ./src
COPY public ./public

ENV PORT=18888 \
    NODE_ENV=production

EXPOSE 18888

# 健康检查（alpine 自带 wget）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:18888/ >/dev/null || exit 1

CMD ["node", "server.js"]
