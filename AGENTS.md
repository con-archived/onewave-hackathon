# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# AI Agent Guidelines

## Project Context

This is a **Backend-only** hackathon repo at the root. Frontend (React) lives in `frontend/` when needed and is not part of the default build/test.

- **Speed and Efficiency**: Prioritize working code and speed over perfect architecture.
- **Environment**:
    - **Root = Backend**: Hono (Cloudflare Workers / Node), Wrangler for dev. All backend code is under `src/`, `tests/`, `scripts/`.
    - **Frontend** (optional): `frontend/` — React + Vite; run from that folder if needed.

## Common Commands

### Development (backend at root)

```bash
npm install
npm run dev          # Wrangler dev (localhost:5174)
npm run dev:node    # Node server with DB (DATABASE_URL)
```

### DB (Docker)

```bash
npm run db:up
npm run db:init
npm run db:check
```

### Build & Test

```bash
npm run build
npm run test
npm run type-check
```

### Lint & Format

```bash
npm run lint
npm run lint:fix
npm run format
```

## Architecture

### Hono RPC Pattern

1. **Backend** (`src/index.ts`): Define routes and export `AppType`.
2. **Frontend** (if used): Import `AppType` from backend; `src/client.ts` provides `createClient(baseUrl)` for typed `hc<AppType>()` usage.

### Folder Structure (backend at root)

- `src/` — app entry, routes, db, lib (gemini, genius), vocabulary.
- `tests/` — unit/integration tests.
- `scripts/` — init-db.sql, check-db.ts.
- `frontend/` — optional React app; not in root workspace.

## Coding Standards

### TypeScript

- **For AI Agents**: Do not use `any`; type all variables and functions.
- **For Humans**: `any` allowed only when stuck or in a rush.

### General

- Keep solutions simple. Basic tests for critical paths.

## Specific Instructions

- **Backend (Hono)**: Cloudflare Workers (Wrangler) or Node via `server-node.ts`. Use chained route calls.
- **Frontend**: Functional components and hooks when working in `frontend/`.

## Forbidden Actions

- Do not add heavy libraries without checking.
- Do not block the build on minor lint/style issues.

### Docs

- [Hono](https://hono.dev/llms.txt)

### Chore

- Use `npm` (not pnpm) for package management.
