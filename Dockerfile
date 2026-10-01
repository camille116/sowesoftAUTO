FROM node:22-bookworm-slim

# Chromium sert à la fois à WhatsApp Web et au robot de signature
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji fonts-liberation tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    TZ=Europe/Paris \
    NODE_ENV=production

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY config ./config

# sessions WhatsApp / SoWeSign, état des signatures, captures
VOLUME /app/data
EXPOSE 3000
CMD ["node", "src/index.js"]
