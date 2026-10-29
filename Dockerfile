# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
WORKDIR /app

# ---- frontend build
FROM base AS frontend-build
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
RUN cd frontend && npm run build

# ---- backend build (needs the Prisma CLI to generate the client)
FROM base AS backend-build
COPY backend/package*.json backend/
RUN cd backend && npm ci
COPY backend backend
RUN cd backend && npm run build

# ---- migrations: one-shot job that applies prisma/migrations (never run on app start)
FROM base AS migrate
COPY backend/package*.json backend/
RUN cd backend && npm ci
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
WORKDIR /app/backend
USER node

# ---- runtime: production dependencies only, non-root, no Prisma CLI
FROM base AS runtime
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
