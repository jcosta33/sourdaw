# Sourdaw

Sourdaw is a browser-first DAW built with React 19, TypeScript, Vite, pnpm,
Rust, and Tauri. The frontend follows module boundary contracts documented in
`AGENTS.md`; backend/native work is split across the Rust workspace crates under
`crates/` and the thin Tauri bridge in `src-tauri/`.

## Agent workflow

Development work is driven by the sibling Suspec workspace at
`../sourdaw-works`. Start with the assigned task packet in
`../sourdaw-works/tasks/`, read the linked process/spec material there, and
follow the repository rules in `AGENTS.md` before editing code.

## Common commands

- `pnpm dev` - start the Vite app
- `pnpm test:run` - run Vitest once
- `pnpm typecheck` - run TypeScript checks
- `pnpm deps:validate` - validate frontend dependency boundaries
- `pnpm build` - create a production build

## Git hooks

`pnpm install` configures the repository-local Git hooks path. The checked-in
pre-push hook runs the same web and collaboration-server health gates as CI.
Use standard Git `--no-verify` only when you intentionally need to bypass it.
