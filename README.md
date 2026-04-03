# Card Tally

An end-to-end vibe-coded, local-first web app for organizing and tallying credit card statements.

## Architecture

- **Frontend** ([`frontend/`](frontend/)): React + TypeScript + Vite. Calls the HTTP API under the `/api` prefix.
- **Backend** ([`backend/`](backend/)): Rust (Axum) + SQLx + SQLite. Serves JSON over `/api/*` (e.g. `/api/statements`, `/api/imports`).
- **Data**: SQLite. By default the backend uses `DATABASE_URL` `sqlite:card-tally.db` (a file in the **current working directory** when you start the binary). In Docker, the DB file is `card-tally.db` on the `card-tally-data` volume mounted at `/data` inside the backend container (`sqlite:/data/card-tally.db`).

## Prerequisites

- [mise](https://mise.jdx.dev/) — installs Node and Rust from `mise.toml`

## Quick Start

```bash
mise install          # install Node + Rust toolchains
mise run setup        # npm install + cargo fetch + cargo-watch install
mise run dev          # backend :3000 + frontend :8080 with hot reload (single terminal)
# or: mise run dev-backend   # one terminal
#     mise run dev-frontend  # other terminal
```

### Docker

Persistent data lives in the named volume `card-tally-data`.

```bash
mise run docker-up
mise run docker-down
```

Open the UI at [http://localhost:8080](http://localhost:8080).

## Sample Statements

Synthetic import-ready CSVs are provided in [`samples/`](samples/):

- `samples/Amex.sample.csv`
- `samples/Yonder.sample.csv`
