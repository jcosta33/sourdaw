# src-tauri — Agent Guidelines

Tauri 2 desktop shell (lib `sourdaw_lib`; `src/main.rs` → `sourdaw_lib::run()`). All Tauri commands live here — never in workspace crates.

## Command surface

- ~82 commands registered in one `tauri::generate_handler!` at `src/lib.rs`. Implementations are grouped by domain under `src/commands/`: `native_llm.rs` (mistral.rs in-process LLM), `ai_audio.rs` (DeepFilterNet denoise, Demucs stems via ONNX `ort`), `audio_postprocess.rs` (rubato/hound resample/post-process), `audio_gen.rs` (Stable Audio Python sidecar at `sidecar/audio_gen.py`), `speech.rs` (whisper-rs dictation), `filesystem.rs`, `plugins.rs` + `plugin_gui.rs` (CLAP only; VST3/AU are not advertised or loadable), `midi.rs` (midir plus Push 2 MIDI/USB display transport), `link.rs` (unsupported Link capability surface; no native Link library is linked), `collab.rs` (CRDT + LAN), `crumbs.rs` (native sampler), `pitch_edit.rs`, `tuning.rs`. `model_download.rs` is a helper module (no commands).
- Naming: snake_case; multi-command domains use a prefix (`collab_*`, `crumbs_*`, `link_*`).
- Managed state registered in `src/lib.rs`: `AppState`, `CollabState`, `LinkState`, `MidiState`, `PushState`, `NativeLlmState`, `DictationState`, `AudioGenState`, `CrumbsState`.
- Frontend reaches commands **only** via `src/utils/tauriBridge.ts` from module-root `repositories/` (enforced by `tauri-ipc-only-in-repositories`). Bridge folders typically mirror command files (e.g. `PluginHost/repositories/pluginBridge/` ↔ `commands/plugins.rs`), but not every command file has a bridge.

## Real-time invariants (hard)

- The CPAL callback lives in `crates/daw-engine/src/audio_thread.rs`. On the audio path: **no heap allocation, no locks, no IPC** — scratch buffers are preallocated (`host/native_bridge.rs`).
- Never final-drop a hosted plugin on the audio thread — removed CLAP runtimes go to `retired_engine_plugins` (`src/state.rs`).
- If non-RT control owns a plugin wrapper's mutex, the RT path bypasses it rather than waiting (`host/native_bridge.rs`).
- WebAudio↔Rust audio crosses `PluginAudioBridge` (rtrb SPSC rings sized from `MAX_CALLBACK_FRAMES`, 36 blocks × up to 512 frames stereo), relayed from the worklet via main-thread MessagePort (`commands/plugins.rs` — `process_plugin_audio`). Capacity is headroom, not latency: the callback sheds stale blocks to hold the round trip near the device period, so latency stays at that depth instead of ratcheting up to the ring.
- Note: the native chain currently renders silence except bridged plugins (`audio_thread.rs`) — timeline audio is a Web Audio concern.

## Gotchas

- `#[specta::specta]` derives exist on a few commands (`plugins.rs`, `tuning.rs`), but **no binding-export call site exists** — TS payload types are hand-maintained. Keep both sides in sync manually.
- `commands::audio_ipc` in the handler list is a commented-out TODO — the module does not exist yet.
- Plugin scanning is policy-gated (`src/host/plugin_scan_policy.rs`): absolute paths only, symlinks rejected. CLAP descriptor extraction runs only in the bounded `plugin_scan_worker` child-process mode; the application process may enumerate authorized candidates but must never load their entry points during discovery.
- MTS-ESP host support is absent; do not add registration or publication until its ownership and distribution contracts are settled.
