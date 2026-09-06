# Umbry Player

The Umbry media-player client — a fork of [Jellyfin Web](https://github.com/jellyfin/jellyfin-web) (GPL-2.0) supporting **Jellyfin, Emby & Plex** with a shared cinematic UI, 17 themes, built-in Live TV, a cross-server watchlist, and a PIN-locked Kids Mode. Part of the [Umbry](../) monorepo — see the top-level README for an overview.

## Build

Requires Node 20+.

    npm ci
    npm run build:production

Output is written to `dist/`. For development, `npm run serve` starts the webpack dev server on port 8081.

Umbry's own code lives chiefly in files matching `src/**/jpx*`. See [`../UMBRY_SOURCE_NOTICE.txt`](../UMBRY_SOURCE_NOTICE.txt) for attribution.

## License

GPL-2.0 — see [`../LICENSE`](../LICENSE).
