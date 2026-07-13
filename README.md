# Sourdaw

Sourdaw is a browser-first DAW built with React 19, TypeScript, Vite, pnpm,
Rust, and Tauri. The frontend follows module boundary contracts documented in
`AGENTS.md`; backend/native work is split across the Rust workspace crates under
`crates/` and the thin Tauri bridge in `src-tauri/`.

## Project governance

Project specifications live under `.agents/specs/`, captured source material
under `.agents/specs/intake/`, and accepted architecture decisions under
`.agents/decisions/`.

## Setup

Install both dependency sets before the first push from a checkout:

```sh
pnpm install
npm --prefix server ci --include=dev
```

`pnpm install` also configures the checked-in Git hooks. Server dependencies are
separate setup; the pre-push gate does not run `npm ci`.

## Common commands

- `pnpm dev` - start the Vite app
- `pnpm test:run` - run Vitest once
- `pnpm typecheck` - run TypeScript checks
- `pnpm deps:validate` - validate frontend dependency boundaries
- `pnpm build` - create a production build

## Git hooks

The checked-in pre-push hook runs the same web and collaboration-server health
gates as CI. Use standard Git `--no-verify` only when you intentionally need to
bypass it.
