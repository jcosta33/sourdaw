# Agent Prompt — Team 7: Rust Core

You are a migration agent assigned to **Team 7: Rust Core**.

## Task file — fill in before any work begins

Your task file has been created for you in this worktree under `agents/tasks/`. Its path was passed to you when this session launched.

Fill in **Objective** and **Plan** before writing any code. Keep it updated throughout:

- **Crate checklist** — one entry per crate/area below, marked pending / in-progress / done
- **Findings** — architectural issues discovered (business logic in Tauri commands, RT violations, crate boundary leakage, etc.)
- **Open questions** — anything uncertain about crate topology, RT safety, or plugin host ownership

Fill in **Handoff** before ending the session. Never leave it empty.

---

## Read these first

Before touching any code, read and internalise:

- `docs/architecture/01-system.md` — system-level invariants, especially the engine and RT sections
- `docs/architecture/02-rust-backend.md` — the full Rust backend topology and crate responsibilities
- `.agents/specs/architecture-refactor/architecture-migration.md` — the staged migration strategy

Relevant skills — apply throughout:

- `.agents/skills/web-audio-engine/` — RT boundary rules (also applies to the Rust engine)
- `.agents/skills/tauri-platform/` — what belongs in src-tauri vs crates
- `.agents/skills/plugin-hosting/` — plugin host architecture
- `.agents/skills/manage-task/` — how to keep the task file current

---

## Your scope

You own the entire Rust backend. You do not touch any TypeScript code.

Your areas, in suggested order:

1. `crates/daw-dsp/` — pure DSP algorithms (lowest risk)
2. `crates/daw-core/` — shared data types and project model fragments
3. `crates/proof-chamber/` — WASM crate (assess against target topology)
4. `crates/scoring/` — WASM crate (assess against target topology)
5. `crates/daw-io/` — native I/O (files, codecs, MIDI, dictation)
6. `crates/daw-plugin-host/` — plugin scanning, instantiation, editor lifecycle
7. `crates/daw-collab/` — assess: does this belong in daw-core or stay separate?
8. `crates/daw-llm/` — assess: is this the right crate boundary?
9. `crates/daw-engine/` — RT + non-RT engine runtime (highest risk)
10. `src-tauri/src/` — Tauri bridge (commands, state, relay)

---

## Your boundary

You may only modify files inside:
- `crates/`
- `src-tauri/src/`

Do not touch any TypeScript or frontend code.

---

## What to look for and fix

### `src-tauri/src/commands/`

The architecture rule is: commands extract typed input, access app state, delegate to crate logic, and translate errors. They must not be the business layer.

For each command file:
- Business logic inside the handler → move it to the appropriate crate
- Multi-step orchestration → extract a function in the relevant crate
- Raw internal error chains leaked to frontend → translate at the bridge boundary
- I/O that belongs in `daw-io` → move it

### `src-tauri/src/state.rs`

Should hold native handles and managers only — not business truth. Check for anything that duplicates what the TypeScript project store already owns.

### `crates/daw-core/`

Lightweight foundation only: IDs, newtypes, units, project model fragments, transport/routing/automation/MIDI types, shared enums. No Tauri, no CPAL, no plugin scanning, no command handlers, no RT callback logic.

### `crates/daw-engine/`

The RT boundary is absolute. On the audio callback path, verify there are:
- No allocations
- No locks (`Mutex::lock`, `RwLock::write`)
- No file/network I/O
- No Tauri calls
- No dynamic dispatch through slow paths

Check that the engine exposes a clean `EngineHandle` API, uses lock-free RT↔non-RT communication (atomics, triple-buffer, SPSC queue), and has no `tauri` dependency in `Cargo.toml`.

### `crates/daw-dsp/`

Must be pure and portable. No Tauri, no commands, no UI, no business workflows. Note: some reverb files were recently deleted — verify the deletion was intentional and the DSP surface is complete.

### `crates/daw-plugin-host/`

Plugin hosting is a subsystem. Verify it is cleanly separated from `daw-engine` and `src-tauri`. Project-side plugin state and runtime plugin state must stay distinct. Fast path (parameter updates, RT processing) must be separated from slow path (scanning, instantiation, editor windows).

### `crates/daw-io/`

Focused on native I/O only: project file read/write, audio codec decode/encode, MIDI I/O, dictation/capture, filesystem workflows. Not a generic junk drawer.

### `crates/daw-collab/` and `crates/daw-llm/`

Assess each against the target topology in `docs/architecture/02-rust-backend.md`. The architecture prefers 4–6 crates split by runtime/dependency boundary, not one per domain concept. Decide whether each crate is justified or should be a module inside an existing crate. Document your decision in the task file.

### `crates/proof-chamber/` and `crates/scoring/`

These are WASM crates used by frontend instrument modules. Verify they are correctly scoped as WASM targets, free of Tauri dependencies, and contain no business logic that belongs elsewhere.

---

## Real-time safety is non-negotiable

Before modifying anything in `daw-engine` on or adjacent to the RT path, identify whether the code path is called from the audio callback. If yes, verify the RT rules hold after your change. If unsure, leave the RT-path code structurally unchanged and only improve the boundaries around it.

A migration that breaks RT safety is worse than no migration.

---

## Coordination note

Team 7 is fully independent of all TypeScript teams (Teams 1–6). There are no shared files. This team can run in parallel with everyone from day one.
