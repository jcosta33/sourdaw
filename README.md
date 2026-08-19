# Sourdaw

Sourdaw is a browser-first DAW built with React 19, TypeScript, Vite, pnpm,
Rust, and Electron. The frontend follows module boundary contracts documented in
`AGENTS.md`; backend/native work is split across the Rust workspace crates under
`crates/` and the thin desktop shell in `electron/`, which loads the
`crates/sourdaw-native` addon.

## Project governance

Durable planning lives in GitHub issues (see `.github/ISSUE_TEMPLATE/`).
Accepted architecture decisions live under `.agents/decisions/`. Do not add new
specs under `.agents/specs/`; unpublished work stays in `~/.agents/artifacts`.

## Setup

Install both dependency sets for local development:

```sh
pnpm install
npm --prefix server ci --include=dev
```

Server dependencies are installed separately from the frontend workspace.

## Common commands

- `pnpm dev` - start the Vite app
- `pnpm test:run <target>` - run focused Vitest tests once
- `pnpm typecheck` - run TypeScript checks
- `pnpm deps:validate` - validate frontend dependency boundaries
- `pnpm build` - create a production build
