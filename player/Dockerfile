# --- build stage: compile the web app from source ---
FROM node:24-bookworm AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:production

# --- serve stage: static files via nginx ---
FROM nginx:alpine
LABEL org.opencontainers.image.title="Umbry Player" \
      org.opencontainers.image.description="Umbry web client for Jellyfin, Emby & Plex (GPL-2.0)" \
      org.opencontainers.image.url="https://umbry.org" \
      org.opencontainers.image.source="https://github.com/UmbryApp/umbry"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/ /usr/share/nginx/html/
EXPOSE 80
