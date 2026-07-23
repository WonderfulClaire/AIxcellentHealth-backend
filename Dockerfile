FROM node:22-slim

# better-sqlite3 是原生模块，安装编译依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

CMD ["npm", "run", "start"]
