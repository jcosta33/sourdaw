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

---

## Platform layer (Team 6 audit — 2026-04-04)

### PL-1 · `RotaryKnob` imports MIDI module — design system boundary violation

**Severity:** P2 · **Open**

`src/components/daw/RotaryKnob.tsx` subscribes to `midiLearnStore` and calls `startMidiLearn` use case directly. A base DAW design system component should be presentation-only. The component also encodes DAW domain types in its prop `targetType?: 'trackGain' | 'trackPan' | 'deviceParam' | 'fermenterGlobalParam'`.

**42 callers** across Fermenter, Yeast, Crust, Bacteria, Gluten, Proof, Levain, Scoring, ProofChamber, Toaster, Workspace.

**Ownership:** Platform leads step 1 (modify `RotaryKnob.tsx`); module owners must complete step 2 (update callers) before step 1 can land without breaking MIDI learn.

**Fix:** (1) Add `isMidiLearning?: boolean`, `isMidiMapped?: boolean`, `onMidiLearn?: () => void` as optional props to RotaryKnob; remove the internal `midiLearnStore` subscription and `startMidiLearn` call. (2) Update all 42 callers in plugin modules to inject MIDI state from outside. Both steps must ship together — step 1 alone silently kills MIDI learn across all 42 callers.

---

### PL-2 · `AutomergeStorage.ts` — upward dependency from platform helper to module internals

**Severity:** P1 · **Open** · `deps:validate` violation (`helpers-no-module-imports`)

`src/helpers/Store/Storage/AutomergeStorage.ts` imports:
- `DocId` from `src/modules/CrdtDocument/models/CrdtDocumentTypes`
- `automergeRepository` from `src/modules/CrdtDocument/repositories/automergeRepository`
- `getSemanticContext` from `src/modules/CrdtDocument/useCases/semanticChangeContext`

Platform helpers must not depend on modules. This creates a circular architectural layer. **12 module stores** depend on `AutomergeStorage` (Transport, Arrangement, Project, MIDI, Automation, Routing, Synth stores).

**Ownership:** Platform leads the `AutomergeStorage.ts` refactor; CrdtDocument module owners must update all 12 store callers at the same time.

**Fix:** Change `AutomergeStorage` constructor to accept `automergeRepository` and `getSemanticContext` as injected parameters (removing the static module imports). All 12 callers must be updated simultaneously to pass those dependencies. Both halves must ship together — the constructor change alone breaks every store that uses `AutomergeStorage`.

---

### PL-3 · `appEvents.ts` contains plugin-specific domain events

**Severity:** P2 · **Open**

`src/helpers/Event/appEvents.ts` contains 13 plugin-tab-show event constants (`SHOW_FERMENTER_TAB`, `SHOW_GRINDER_TAB`, `SHOW_TOASTER_TAB`, `SHOW_LEVAIN_TAB`, `SHOW_ORCHESTRAL_TAB`, `SHOW_PROOF_CHAMBER_TAB`, `SHOW_GLUTEN_TAB`, `SHOW_BACTERIA_TAB`, `SHOW_SCORING_TAB`, `SHOW_PROOF_TAB`, `SHOW_YEAST_TAB`, `SHOW_CRUST_TAB`, `SHOW_AUTOMATION_TAB`). These are module-specific domain knowledge baked into a generic platform helper.

Generic cross-cutting events (SAVE_PROJECT, UNDO, REDO, ZOOM_*, etc.) belong here. Plugin-tab events should live in their owning module or in the Workspace module that consumes them.

**Ownership:** Module owners lead this — the initiative must come from the module side (relocate callers first, then the constants can move out of the helper).

**Fix:** Module owners move their `SHOW_*_TAB` usages to import from a module-local event constant; once all callers are migrated, Platform removes those keys from `APP_EVENTS`.

---

### PL-4 · `bootstrap.ts` initializes module-specific subscriber

**Severity:** P2 · **Open**

`src/app/bootstrap.ts` calls `initToasterSubscribers()` from `src/modules/Toaster/useCases/toasterSubscriber`. Platform bootstrap should initialize only infrastructure (Logger, Container, EventBus). Module-specific event subscriber wiring belongs inside the Toaster module's own initialization path.

**Ownership:** Toaster module leads — add self-registration in `src/modules/Toaster/`; Platform removes the call from `bootstrap.ts` once that lands.

**Fix:** Toaster module adds self-registration (e.g. call `initToasterSubscribers()` from the module's own init path so it fires on first import). Once confirmed working, Platform removes `initToasterSubscribers()` from `bootstrap.ts`. The two changes must be sequenced — remove the bootstrap call only after self-registration is live.

---

### ~~PL-5 · `colorPresets.ts` exports domain-named constants from generic helper~~ — DONE

**Severity:** P3 · ~~Open~~ **Resolved (Team 6)**

`src/helpers/UI/colorPresets.ts` exported `TRACK_COLOR_PRESETS` and `CLIP_COLOR_PRESETS` — DAW domain concepts that did not belong in the generic platform helper.

**Resolution:** Canonical implementation moved to `src/components/daw/colorPresets.ts` (the DAW design system layer — the appropriate home for DAW-domain presentation constants). `src/helpers/UI/colorPresets.ts` is now a thin shim re-exporting from the new location, preserving all 4 module import paths unchanged. `pnpm typecheck` and `pnpm deps:validate` both pass with zero new violations.

---

### PL-6 · `LocalStorageKeys.ts` contains ~28 unused non-DAW keys

**Severity:** P3 · **Open** · Requires human/legal review

`src/helpers/Store/Storage/LocalStorageKeys.ts` has a legal notice referencing Carmen Cuomo and Cookie Policy compliance. The file mixes DAW-specific keys (`sourdaw-*` prefix) with ~28 keys that appear to belong to a brand-management SaaS product (e.g., `navigationBrandsSearch`, `brandContentListingView`, `assetchooser_brand_id`). None of the non-DAW keys are referenced anywhere in this codebase.

**Fix:** Human review required. Legal sign-off from the appropriate person (Carmen Cuomo or equivalent) before removing the stale non-DAW keys.

---

### RB-2 · Business logic in Tauri command handlers

**Severity:** P2 · **Partially resolved**

~~`llm.rs`~~ **Removed.** `native_llm.rs` fully supersedes the sidecar approach (mistralrs in-process, tool calling, schema-constrained generation). No TypeScript callers for any sidecar command were found. `get_model_dir` migrated to `native_llm.rs`.

`plugin_gui.rs` (225 lines): window creation, native window handle extraction, platform-specific conversion, CLAP GUI lifecycle. **On review:** this code is correctly structured — window creation is inherently a Tauri concern and the actual CLAP lifecycle is already delegated to `instance.open_gui()`. No refactor needed here.
