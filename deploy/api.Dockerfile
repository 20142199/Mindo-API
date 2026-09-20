FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY admin/package.json admin/package.json
RUN npm ci

COPY api api
RUN npm run prisma:generate -w api && npm run build -w api

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/api/package.json ./api/package.json
COPY --from=build --chown=node:node /app/api/dist ./api/dist
COPY --from=build --chown=node:node /app/api/prisma ./api/prisma

RUN mkdir -p /app/api/storage/kyc && chown -R node:node /app/api/storage

USER node
EXPOSE 4000

CMD ["sh", "-c", "npm run prisma:deploy -w api && node api/dist/src/main.js"]
