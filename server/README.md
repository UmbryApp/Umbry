# Umbry Server

The optional Umbry sync backend (Node + Fastify, pure-JS — no native modules). It stores only your **account settings** — saved servers, watchlist, PIN, parental rules, themes — so they sync across every device where you run the Player. It **never touches your media**. On first run it auto-provisions its own JWT signing key and AES encryption key (stored in the data dir), so it self-hosts with zero configuration.

## Run (Docker)

    docker build -t umbry-server .
    docker run -d -p 8790:8790 -v umbry-data:/data umbry-server

Then connect the Umbry Player to `http://<host>:8790`.

## Run (Node)

    npm install
    npm start

## Configuration (all optional, via environment)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8790` | Listen port |
| `DATA_DIR` | `/data` | Where the JSON store + secrets live |
| `TOKEN_TTL` | `30d` | Session token lifetime |
| `CORS_ORIGINS` | (any) | Comma-separated allowed origins |
| `JWT_SECRET` | auto | Override the auto-provisioned signing key |
| `ENC_KEY` | auto | Override the auto-provisioned encryption key (base64, 32 bytes) |

## License

GPL-2.0 — see [`../LICENSE`](../LICENSE).
