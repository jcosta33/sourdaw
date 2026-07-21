# daw-dsp crate — Agent Guidelines

Pure mathematical DSP: the 10 bread-named device engines (see the root `AGENTS.md` naming key). Each engine is a module here (`src/fermenter/`, `src/toaster/`, `src/grand_boule/`, …) with a `#[wasm_bindgen]` `*Instance` struct — except `crumbs`, which is **native-only**.

## Hard rules

- **Allocation-free, lock-free audio path.** Proven by dev-dependency `assert_no_alloc` tests — if you add allocation in a `process`/render path, those tests fail. Keep them passing; they are the RT contract.
- Pure DSP only: no I/O, no Tauri, no repositories. Dependencies stay minimal (`wasm-bindgen`, `serde`).
- Dual compilation target: native (linked via `daw-engine`) **and** WASM (`pnpm wasm:dsp` → `public/wasm/daw-dsp`). Code must compile cleanly for both; gate platform-specific bits behind `cfg(target_arch = "wasm32")` as existing modules do.

## Conventions

- Engine module names are snake_case versions of the TS module names (`GrandBoule` ↔ `grand_boule`).
- The reverb ("Dutch Oven" / ProofChamber) is **not** here — it's the sibling `proof-chamber` crate; the tuner is the `scoring` crate.
- After changing an engine's WASM surface, rebuild with `pnpm wasm:dsp` (or `wasm:all`) so the worklet glue in `src/modules/AudioEngine/wasm/` regenerates — see `src/modules/AudioEngine/AGENTS.md`.
