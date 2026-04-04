# Sourdaw — Open Issues

All items verified against the current codebase.

---

## Real-time infrastructure

### ~~RT-5 · NativePluginBridgeNode JSON IPC in the audio hot-path~~ — DONE

**Two bugs fixed:**

**Bug 1 — Unbounded queue growth (correctness):** The worklet fired a `postMessage` every `process()` call regardless of whether the previous IPC round-trip completed. Under any load where the round-trip took >2.67ms, the queue grew forever. Fixed with a `pendingBlock` flag in `NativePluginBridgeNode.ts` — new blocks are dropped while a round-trip is in flight. The Rust-side ring buffer (8 blocks deep) absorbs transient delays; the worklet outputs the last available block.

**Bug 2 — JSON float serialization:** `Array.from(audioData)` serialized 256 f32 values as JSON number strings. Changed to pass raw IEEE 754 bytes (`Uint8Array`) and accept `Vec<u8>` on the Rust side, decoding with `f32::from_le_bytes`. Smaller JSON payload and cheaper Rust-side parse (integer 0-255 vs decimal float string).

**SabBridge removed:** `sab_bridge.rs` was premised on JS and Rust sharing process memory (true only on macOS WKWebView, false on Windows WebView2). No JS API exposes a SAB's raw address regardless. The whole approach was unviable cross-platform. Removed: `sab_bridge.rs`, `register_plugin_bridge` Tauri command, `RegisterBridge`/`UnregisterBridge` scheduler commands, `process_bridges()` audio-thread call.

**Remaining ceiling:** The ring buffer IPC still has an async round-trip (JS→Rust→JS) bounded by the OS scheduler. True zero-copy would require Tauri's raw-body fetch API (`ipc://localhost/` scheme with `ArrayBuffer` body). This is the next optimization if round-trip latency is measurably causing audio glitches.

---

## Architectural

### ~~SP-1 · Branch topology not synced to CRDT~~ — DONE

Session-scoped branch metadata sync implemented. A `__branches__` Automerge doc (see `DOC_BRANCHES` in `CrdtDocumentTypes.ts`) carries the `BranchRecord[]` list during a session. `AutomergeSync` now syncs all docs (`root`, `__branches__`, `branch_*`), using per-peer-per-doc `SyncState` maps. `sessionManagement.ts` seeds the doc on `createSession`, subscribes to local `branchStore` mutations to mirror them into the Automerge doc, and projects incoming peer changes back into `branchStore`. On `leaveSession`, the pre-session snapshot is restored and the `__branches__` doc is removed so it isn't included in subsequent IDB saves. `activeBranchId` is not synced — each peer keeps their own active branch.

---

## Rust backend

### ~~RB-1 · Crate workspace sprawl~~ — DONE

Dead reverb code removed:
- `crates/daw-dsp/src/reverb/` — entire directory deleted (5 files: `dattorro.rs`, `engine.rs`, `allpass.rs`, `delay.rs`, `mod.rs`). `ProofChamberEngine` was never exported from `lib.rs`, never registered as a device type, never called from TypeScript.
- `crates/daw-dsp/src/effects/proof_chamber.rs` — deleted. A 645-line copy of the full `ProofChamber` struct was wired into `WasmPluginInstance` as `"proof-chamber"` type, but had no TypeScript descriptor or device strategy registration — users could not instantiate it.
- `crates/daw-dsp/src/effects/` — entire directory deleted (compressor, delay, eq, gain, gate, lib, limiter, reverb). All 7 `native-*` DSP effects removed as part of platform-agnostic cleanup.
- `daw-dsp/src/lib.rs` — `pub mod reverb` removed.
- `proofChamberParamBridge.ts` — removed legacy `|| device.type === 'proof-chamber'` check.

Platform-agnostic cleanup completed:
- `NativeDspNode.ts`, `nativeDspProcessor.ts`, `audioCoreProcessor.ts` — deleted.
- `audio_core.*` WASM files — deleted.
- `NativeEffectLayouts.tsx` — deleted.
- `nativeDspDescriptors.ts` — rewritten to contain only Dutch Oven and Scoring (removed 7 `native-*` effect descriptors).
- `builtinEffectDescriptors.ts` — all `platform: 'web'` → `platform: 'both'`; builtin effects now show on native too.
- `getPlatformPlugins.ts` — `WEB_TO_NATIVE_MAP` removed; single passthrough filter (hide `native`-only platform).
- `NativeDspDeviceStrategy.ts` — native DSP branch removed; class now serves premium plugins only.
- `deviceStrategy/index.ts` — `isNativeDspDevice` removed from predicate.
- `factoryPresets.ts` — all `native-*` preset helpers and `NATIVE_DSP_PRESETS` array removed.

Live effect landscape: web-based builtins (available everywhere) + premium WASM plugins (Dutch Oven, Fermenter, Toaster, etc.). No platform split.

---

### RB-2 · Business logic in Tauri command handlers

**Severity:** P2 · **Partially resolved**

~~`llm.rs`~~ **Removed.** `native_llm.rs` fully supersedes the sidecar approach (mistralrs in-process, tool calling, schema-constrained generation). No TypeScript callers for any sidecar command were found. `get_model_dir` migrated to `native_llm.rs`.

`plugin_gui.rs` (225 lines): window creation, native window handle extraction, platform-specific conversion, CLAP GUI lifecycle. **On review:** this code is correctly structured — window creation is inherently a Tauri concern and the actual CLAP lifecycle is already delegated to `instance.open_gui()`. No refactor needed here.
