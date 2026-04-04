# Sourdaw — Open Issues

All items verified against the current codebase.

---

## Real-time infrastructure

### RT-5 · NativePluginBridgeNode JSON IPC in the audio hot-path

**Severity:** P0 · **Verified:** ✅

`NativePluginBridgeNode.ts` (line 45) still calls `tauriInvoke('process_plugin_audio', { enginePluginId, audioData: Array.from(audioData) })` — converting a `Float32Array` to a plain array for JSON serialisation on the main thread at audio rate. The worklet sends audio out via `postMessage` every block, the main thread awaits the Tauri response and posts it back. No guard against falling behind: the worklet unconditionally sends a new block every `process()` call regardless of whether the previous round-trip has completed, meaning the message queue grows unbounded under load.

**Confirmed:** `NativePluginBridgeNode.ts` uses `Array.from(audioData)` which is a major performance bottleneck for real-time audio.

**Rust side is done:** `SabBridge`, `register_plugin_bridge` Tauri command, and `process_bridges()` audio-thread polling are all fully implemented in `crates/daw-engine/src/sab_bridge.rs`. Never called from TypeScript.

**Blocker:** No standard JS API exposes the raw address of a `SharedArrayBuffer`. `register_plugin_bridge` takes `sab_ptr: usize`. The issue spec says "Map the SAB into Rust via the WASM bridge" — this glue does not yet exist. Resolve before starting JS work.

**JS work once unblocked (small):**

1. New `nativePluginBridgeProcessor.ts`: on `init-sab`, store SAB views; in `process()`, read last output from SAB, write new input, set control word. No `postMessage` during `process()`.
2. Update `NativePluginBridgeNode.ts`: allocate 2052-byte SAB, call `register_plugin_bridge`, post `init-sab`, remove async relay loop.

---

## Architectural

### SP-1 · Branch topology not synced to CRDT

**Severity:** P1 · **Verified:** ✅

`branchStore.ts` line 11: `new Store<BranchStoreState>(logger, { storage: new LocalStorageStorage('sourdaw-branches') })`. Branch documents themselves are in Automerge, but the `BranchRecord` list (IDs, names, sourceIds) is localStorage-only. In a collaborative session, peer B never sees peer A's branches. `BranchManagerDialog` (fork, switch, merge, delete) is active UI.

**Confirmed:** `src/modules/CrdtDocument/stores/branchStore.ts` explicitly uses `LocalStorageStorage`. `actionHistoryStore.ts` is also local-only.

**Requires product decision:** are branches a local workspace concept (intentional) or should they sync to collaborators?

**If synced:** move `BranchStoreState` into a dedicated Automerge metadata document synced alongside the project doc. Use `src/modules/CrdtDocument/models/BranchTypes.ts` as the schema.

---

## Rust backend

### RB-1 · Crate workspace sprawl

**Severity:** P2 · **Verified:** ✅ (with correction)

`Cargo.toml` has 9 workspace members: `daw-core`, `daw-collab`, `daw-engine`, `daw-dsp`, `daw-io`, `daw-plugin-host`, `proof-chamber`, `scoring`, `src-tauri`. `proof-chamber` and `scoring` are standalone WASM crates (`crate-type = ["cdylib", "rlib"]`) with no dependencies on any `daw-*` crate — only `wasm-bindgen`, `serde`, `js-sys`.

**Duplication claim corrected:** `daw-dsp/src/proof/` is the *Proof mastering suite* (EQ → multiband dynamics → stereo imager → limiter); `proof-chamber` is *Dutch Oven*, a completely separate multi-engine reverb plugin (Dattorro plate, FDN-8, FDN-16, spring, convolution). The `daw-dsp/src/reverb/` helper module may partially overlap with `proof-chamber`'s Dattorro sub-module, but this has not been confirmed at code level. `scoring` (chromatic tuner) has no apparent duplication.

**Real issue:** two production WASM plugins ship as root workspace crates with their own `[profile.release]` sections instead of living within the `daw-dsp` plugin family. Consolidation would simplify CI, build scripts, and `wasm-pack` invocations.

**Prerequisite before consolidating:** verify `proof-chamber`'s Dattorro code vs `daw-dsp/src/reverb/dattorro.rs` for actual duplication, then assess `wasm-pack` build pipeline impact.

---

### RB-2 · Business logic in Tauri command handlers

**Severity:** P2 · **Partially resolved**

~~`llm.rs`~~ **Removed.** `native_llm.rs` fully supersedes the sidecar approach (mistralrs in-process, tool calling, schema-constrained generation). No TypeScript callers for any sidecar command were found. `get_model_dir` migrated to `native_llm.rs`.

`plugin_gui.rs` (225 lines): window creation, native window handle extraction, platform-specific conversion, CLAP GUI lifecycle. **On review:** this code is correctly structured — window creation is inherently a Tauri concern and the actual CLAP lifecycle is already delegated to `instance.open_gui()`. No refactor needed here.
