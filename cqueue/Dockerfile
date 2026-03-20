FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# --- Production image ---
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY server ./server

EXPOSE 7705

CMD ["bun", "server/index.ts"]
