FROM oven/bun:1.1.26-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production

# Default command runs the S03E02 task; can be overridden in compose
CMD ["bun", "run", "tasks/S03E02/index.ts"]


