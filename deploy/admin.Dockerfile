FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY admin/package.json admin/package.json
RUN npm ci

COPY admin admin
ARG VITE_API_URL=https://api-mindo.stg-studio.com
ARG VITE_DEMO_MODE=false
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN npm run build -w admin

FROM nginx:1.27-alpine AS runtime
COPY deploy/admin.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/admin/dist /usr/share/nginx/html

EXPOSE 80
