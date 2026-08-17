# Contributing to Sourdaw

Welcome! Sourdaw is a modern, high-fidelity digital audio workstation built on a unified Rust native DSP engine, Electron desktop runtime, and Web Audio.

---

## 1. Commit and PR Standards

We strictly follow the **Conventional Commits** specification. Every commit and PR title must follow this format:

```text
type(scope): concise description in lowercase/imperative
```

### Allowed Types
- `feat`: New user-facing capability or major architectural feature
- `fix`: Defect repair, audio glitch fix, memory safety, or regression fix
- `refactor`: Structural or domain boundary refactor with zero behavioral diff
- `test`: Adding or repairing tests, assertions, or oracle suites
- `docs`: Documentation, ADRs, user manuals, or guides
- `build`: Tooling, bundling, package dependencies, or compiler config
- `chore`: Maintenance, repository cleanup, or lane housekeeping

### Standard Scopes
- `audio-engine`, `daw-dsp`, `daw-io`, `daw-core`
- `electron`, `native`, `plugin-host`
- `midi`, `arrangement`, `transport`, `mixer`, `piano-roll`
- `yeast`, `bacteria`, `knead`, `levain`, `crumbs`, `grinder`, `grand-boule`, `fermenter`
- `ai`, `workspace-shell`, `security`, `lanes`

---

## 2. Local Development & Verification

Before submitting a Pull Request, verify your changes locally to ensure fast, green reviews without burning remote CI time:

```bash
# Verify TypeScript types & lint
pnpm typecheck
pnpm lint

# Run unit tests
pnpm test

# Run Rust crate tests
cargo test

# Verify WASM artifact freshness (if touching DSP crates)
pnpm wasm:verify
```

---

## 3. Architectural Decision Records (ADRs)

Substantive design decisions (such as audio thread safety, threading models, device layers, or memory bounds) must be recorded as an ADR in [`.agents/decisions/`](.agents/decisions/).
- Follow the ADR format in `.agents/decisions/`.
- Ensure the Markdown H1 heading exactly matches the frontmatter `title`.

---

## 4. Pull Request Discipline

- Keep PRs scoped, focused, and linked to a tracking issue (`Closes #123`).
- Complete all sections of the [Pull Request Template](.github/pull_request_template.md).
- Code reviews must focus on line-level correctness and architectural invariants.
