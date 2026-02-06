# Onewave Backend

Backend-only project at repo root (Hono, Cloudflare Workers / Node). Optional React frontend in `frontend/`.

## Structure

- **Root**: Backend — `src/`, `tests/`, `scripts/`, DB docs, Docker, Wrangler.
- `frontend/`: Optional React + Vite app; run from that folder when needed.

## Getting Started

1. **Install**

    ```bash
    npm install
    ```

2. **Development**

    ```bash
    npm run dev        # Wrangler (localhost:5174)
    npm run dev:node   # Node server + Postgres (set DATABASE_URL)
    ```

3. **DB (Docker)**

    ```bash
    npm run db:up
    npm run db:init
    npm run db:check
    ```

4. **Lint, format, test**
    ```bash
    npm run lint
    npm run format
    npm run test
    npm run type-check
    ```

## Deployment

- Backend: Cloudflare Workers (Wrangler) or Node. See `src/index.ts`, `src/server-node.ts`.
- Frontend: `cd frontend && npm run build` when using the React app.
