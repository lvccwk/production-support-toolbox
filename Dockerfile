# syntax=docker/dockerfile:1
# Production Support Toolbox — Docker 部署(後備方案;主力係 scripts/setup.sh / setup.bat)
# 本地數據 (data/) 用 volume 保存,唔會入 image。見 docker-compose.yml。
#
# 點解雙 stage 裝 build tools:
#   better-sqlite3 係 native module,一般有 N-API prebuilt(唔使編譯);
#   萬一無,先需要 python3/make/g++。deps stage 裝定做後備,runtime 保持 slim。

# ---- 依賴 ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- 構建 ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 運行 ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/public ./public
RUN mkdir -p /app/data
EXPOSE 3000
# 容器入面必須 bind 0.0.0.0(預設 start script 係 127.0.0.1,喺容器內會接唔到)。
# compose 會用 "npx next start -H 0.0.0.0" override;直接 docker build 都可以咁行。
CMD ["npx", "next", "start", "-H", "0.0.0.0"]