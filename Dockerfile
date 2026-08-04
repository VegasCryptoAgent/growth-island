FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# Prefer Railway volume mount at /data when available
ENV DATA_DIR=/app/data
COPY package.json package-lock.json ./
# production runtime only needs server deps; phaser not needed at runtime
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data /app/data/backups
EXPOSE 8080
# JWT_SECRET must be set in Railway variables (server exits if missing)
CMD ["node", "server/index.mjs"]
