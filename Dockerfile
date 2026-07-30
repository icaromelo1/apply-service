FROM mcr.microsoft.com/playwright:v1.62.0-noble

RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src

CMD ["sh", "-c", "npm run db:push && npx tsx src/review/server.ts"]
