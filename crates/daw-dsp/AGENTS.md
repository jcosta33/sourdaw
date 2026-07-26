# daw-dsp crate — Agent Guidelines

Pure mathematical DSP: the 10 bread-named device engines (see the root `AGENTS.md` naming key). Each engine is a module here (`src/fermenter/`, `src/toaster/`, `src/grand_boule/`, …) with a `#[wasm_bindgen]` `*Instance` struct — except `crumbs`, which is **native-only**.

## Hard rules

- **Allocation-free, lock-free audio path.** This is the RT contract; keep it passing. Enforced by dev-dependency `assert_no_alloc` tests, and here is exactly how far that enforcement reaches, because it used to reach less far than this file claimed:
  - **Every `#[wasm_bindgen] process`/render export in this crate is guarded** by `tests/device_process_rt.rs` — one test per device family (bacteria, fermenter, gluten, grand_boule, grinder incl. `process_automated`, knead, levain, proof, toaster). Add allocation to any of them and that test aborts.
  - The sibling `proof-chamber` crate is guarded by its own `tests/reverb_process_rt.rs`, covering plate, fdn-8, fdn-16, spring, reverse, and hybrid in its default algorithmic-only mode. **The Convolution engine is the one render path in either crate that is not allocation-free** — it builds scratch frames per partition boundary, and Hybrid inherits that as soon as its convolution routing is engaged. No product surface can select those, so they are carried weight rather than a live fault; the state is pinned as a measured fact by the last test in that file rather than left unrecorded. Do not treat convolution as covered.
  - Each guard drives its engine into a *configured, audibly active* state and asserts non-silence, because most of these engines early-return when every stage is at its default — a guard wrapped around an unconfigured instance passes without executing any DSP. If you add a family, drive it.
  - **The interceptor is debug-only.** `assert_no_alloc`'s `disable_release` feature is on by default, so in a release build `assert_no_alloc(f)` is literally `f()` and every guard here is a no-op. Run `cargo test` (debug) or you are proving nothing. A violation calls `std::alloc::handle_alloc_error`, which **aborts the process** instead of unwinding, so a failure shows up as `SIGABRT` with `memory allocation of N bytes failed`, not as a normal test failure. `alloc_interceptor_aborts_the_process_on_a_forbidden_allocation` proves the interceptor is actually installed.
  - Guarding `set_param` is not guarding `process`. Three older sites (`toaster/mod.rs`, `fermenter/mod.rs`, `proof-chamber/src/lib.rs`) wrap `set_param_by_id` only; they are control-rate checks and say nothing about the render path. Grep hits for `assert_no_alloc` in a module are not evidence that its audio path is covered — check what the call actually wraps.
- Pure DSP only: no I/O, no Tauri, no repositories. Dependencies stay minimal (`wasm-bindgen`, `serde`).
- Dual compilation target: native (linked via `daw-engine`) **and** WASM (`pnpm wasm:dsp` → `public/wasm/daw-dsp`). Code must compile cleanly for both; gate platform-specific bits behind `cfg(target_arch = "wasm32")` as existing modules do.

## Conventions

- Engine module names are snake_case versions of the TS module names (`GrandBoule` ↔ `grand_boule`).
- The reverb ("Dutch Oven" / ProofChamber) is **not** here — it's the sibling `proof-chamber` crate; the tuner is the `scoring` crate.
- After changing an engine's WASM surface, rebuild with `pnpm wasm:dsp` (or `wasm:all`) so the worklet glue in `src/modules/AudioEngine/wasm/` regenerates — see `src/modules/AudioEngine/AGENTS.md`.
