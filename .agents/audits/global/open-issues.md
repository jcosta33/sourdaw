# Sourdaw — Open Issues

All items verified against the current codebase. Done items removed.

---

## Real-time infrastructure

### RT-5 · NativePluginBridgeNode JSON IPC in the audio hot-path
**Severity:** P0

`NativePluginBridgeNode.ts` receives 128-sample audio blocks from the AudioWorklet via `postMessage`, converts to `Array.from(audioData)` for JSON serialisation, calls `tauriInvoke('process_plugin_audio', { audioData })`, awaits the response, then reconstructs a `Float32Array`. This runs on the main thread at audio rate — allocation cycles every 128 samples, async IPC blocking a real-time path.

**Status of Rust side:** `SabBridge` struct, `register_plugin_bridge` Tauri command, and `process_bridges()` audio-thread polling are all fully implemented in `crates/daw-engine/src/sab_bridge.rs`. Dead code from the JS side — never called from TypeScript.

**Blocker:** No standard JS API exposes the raw address of a `SharedArrayBuffer`. The `register_plugin_bridge` command takes `sab_ptr: usize`. The issue spec says "Map the SAB into Rust via the WASM bridge" — this glue does not yet exist. Resolve this before starting JS work.

**JS work once unblocked (small):**
1. New `nativePluginBridgeProcessor.ts` (~50 lines): on `init-sab`, store SAB views; in `process()`, read last output, write new input, set control word. No postMessage during `process()`.
2. Update `NativePluginBridgeNode.ts`: allocate 2052-byte SAB, call `register_plugin_bridge`, post `init-sab`, remove async relay loop.

---

## Architectural

### SP-1 · Branch topology not synced to CRDT
**Severity:** P1

`branchStore` uses `LocalStorageStorage`. Branch documents themselves are in Automerge, but the `BranchRecord` list (IDs, names, sourceIds) is localStorage-only. In a collaborative session, peer B never sees peer A's branches. `BranchManagerDialog` (fork, switch, merge, delete) is active UI, not dead code.

**Requires product decision:** are branches a local workspace concept (intentional) or should they sync to collaborators?

**If synced:** move `BranchStoreState` into a dedicated Automerge metadata document synced alongside the project doc.

---

## Rust backend

### RB-1 · Crate workspace sprawl
**Severity:** P2

Root `Cargo.toml` has 9 workspace members: `daw-core`, `daw-collab`, `daw-engine`, `daw-dsp`, `daw-io`, `daw-plugin-host`, `proof-chamber`, `scoring`, `src-tauri`. Intended boundary was 5. `proof-chamber` and `scoring` are standalone WASM crates (`crate-type = ["cdylib", "rlib"]`) that should live under `daw-dsp` behind `#[cfg(target_arch = "wasm32")]`.

**First step:** run `cargo tree` and map cross-crate dependencies before consolidating.

---

### RB-2 · Business logic in Tauri command handlers
**Severity:** P2

`llm.rs` (339 lines): spawns the llama-server sidecar, manages TCP port binding and health checks, orchestrates HTTP calls, parses SSE streams — all inside Tauri command functions.

`plugin_gui.rs` (225 lines): window creation, native window handle extraction, platform-specific conversion, CLAP GUI lifecycle — beyond thin DTO unwrapping.

**Fix:** extract orchestration into `daw-engine` or `daw-io` service traits. Tauri commands become thin DTO unwrappers.
