# One reproducible multi-stage build for API and worker.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
# Generate the Prisma client (Prisma 7 driver adapter) before TypeScript compilation.
RUN DATABASE_URL=postgresql://postgres:placeholder@localhost:5432/local npx prisma generate
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Full node_modules includes Prisma CLI for explicit migration jobs; can be slimmed later.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
