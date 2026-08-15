# src-tauri — Agent Guidelines

Tauri 2 desktop shell (lib `sourdaw_lib`; `src/main.rs` → `sourdaw_lib::run()`). All Tauri commands live here — never in workspace crates.

## Command surface

- Every command is registered in the single `tauri::generate_handler!` in `src/lib.rs` and implemented under `src/commands/`, one file per domain. Managed state is registered in `src/lib.rs` alongside it.
- Naming: snake_case; multi-command domains use a prefix (`collab_*`, `crumbs_*`, `link_*`).
- Plugin hosting is CLAP only — VST3/AU are not advertised or loadable. Ableton Link is an unsupported capability surface; no native Link library is linked.
- IPC payload types are hand-maintained on both sides — no binding generator runs. A command signature change must update `src/utils/tauriBridge.ts` types in the same change.
- Frontend reaches commands **only** via `src/utils/tauriBridge.ts` from module-root `repositories/` (enforced by `tauri-ipc-only-in-repositories`). Bridge folders typically mirror command files (e.g. `PluginHost/repositories/pluginBridge/` ↔ `commands/plugins.rs`), but not every command file has a bridge.

## Real-time invariants (hard)

- The CPAL callback lives in `crates/daw-engine/src/audio_thread.rs`. On the audio path: **no heap allocation, no locks, no IPC** — scratch buffers are preallocated (`host/native_bridge.rs`).
- Never final-drop a hosted plugin on the audio thread — removed CLAP runtimes go to `retired_engine_plugins` (`src/state.rs`).
- If non-RT control owns a plugin wrapper's mutex, the RT path bypasses it rather than waiting (`host/native_bridge.rs`).
- WebAudio↔Rust audio crosses `PluginAudioBridge` (rtrb SPSC rings sized from `MAX_CALLBACK_FRAMES`, 36 blocks × up to 512 frames stereo), relayed from the worklet via main-thread MessagePort (`commands/plugins.rs` — `process_plugin_audio`). Capacity is headroom, not latency: the callback holds the round trip within twice the device period by processing a block and then withholding it from the return ring, so latency settles at that depth instead of ratcheting up to the ring. Never shed a block before the plugin sees it — the input side is the native sampler's only record feed.
- Note: the native chain currently renders silence except bridged plugins (`audio_thread.rs`) — timeline audio is a Web Audio concern.

## Constraints

- Plugin scanning is policy-gated (`src/host/plugin_scan_policy.rs`): absolute paths only, symlinks rejected. CLAP descriptor extraction runs only in the bounded `plugin_scan_worker` child-process mode; the application process may enumerate authorized candidates but must never load their entry points during discovery.
- MTS-ESP host support is absent; do not add registration or publication until its ownership and distribution contracts are settled.
