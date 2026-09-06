FROM node:20-bookworm-slim
LABEL org.opencontainers.image.title="Umbry Server" \
      org.opencontainers.image.description="Umbry sync + account backend (GPL-2.0)" \
      org.opencontainers.image.url="https://umbry.org" \
      org.opencontainers.image.source="https://github.com/UmbryApp/umbry"

# pure-JS server (hash-wasm + JSON store) — no native modules, so no build toolchain needed
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./

ENV NODE_ENV=production
EXPOSE 8790
CMD ["node", "server.js"]
