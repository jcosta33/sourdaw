# crates/sourdaw-native — Agent Guidelines

The native audio, DSP and plugin-hosting bodies, plus the Node addon that exposes them (`crate-type = ["cdylib", "rlib"]`). Desktop shells link this crate; they never re-implement it.

## Shell independence

- Nothing here may name a shell. No `tauri::*`, no `electron`, no IPC transport type. A body that needs to reach the host does it through a trait in `events.rs` or `host/` and the shell supplies the implementation.
- Bodies take plain owned arguments and return plain owned results. Byte payloads are `&[u8]` / `Vec<u8>`; how they cross a wire is the shell's decision, and the shared validation for that decision lives in `commands/binary_ipc.rs`.
- Host seams take **owned** payloads: an implementation may hand the value to another thread and outlive the caller's frame.
- A shell adds a command by adding a body here and a wrapper there. The wrapper unwraps transport and calls the body; it never holds behaviour, and no command may exist in one shell only.
- The `napi-addon` feature is off by default so a shell that links this crate as an rlib does not pull the Node addon registration in with it. Nothing outside `src/addon/` may be gated on it.

## Real-time invariants (hard)

- The CPAL callback lives in `crates/daw-engine/src/audio_thread.rs`. On the audio path: **no heap allocation, no locks, no IPC** — scratch buffers are preallocated (`host/native_bridge.rs`).
- No host seam — event sink, event stream, window host, sidecar host — may be called from the audio callback. Every one of them allocates, serializes, or reaches another thread.
- `AppState`'s field order is the drop order and is load bearing: the engine's CPAL stream must be released before the CLAP runtimes it reads. `NativeSingletons` carries the same rule for the same reason. Reordering either field list reorders teardown.
- Never final-drop a hosted plugin on the audio thread — removed CLAP runtimes go to `retired_engine_plugins` (`state.rs`).
- If non-RT control owns a plugin wrapper's mutex, the RT path bypasses it rather than waiting (`host/native_bridge.rs`).
- Webview↔Rust audio crosses `PluginAudioBridge` (rtrb SPSC rings sized from `MAX_CALLBACK_FRAMES`), relayed from the worklet via a main-thread port (`commands/plugins.rs` — `process_plugin_audio`). Capacity is headroom, not latency: the callback holds the round trip within twice the device period by processing a block and then withholding it from the return ring, so latency settles at that depth instead of ratcheting up to the ring. Never shed a block before the plugin sees it — the input side is the native sampler's only record feed.
- The native chain renders silence except bridged plugins (`audio_thread.rs`); timeline audio is a Web Audio concern.

## Constraints

- Plugin hosting is CLAP only — VST3/AU are not advertised or loadable. Ableton Link is an unsupported capability surface; no native Link library is linked.
- Plugin scanning is policy-gated (`host/plugin_scan_policy.rs`): absolute paths only, symlinks rejected. CLAP descriptor extraction runs only in the bounded `plugin_scan_worker` child-process mode; the application process may enumerate authorized candidates but must never load their entry points during discovery.
- Wire payload types are hand-maintained on both sides — no binding generator runs. A body's signature change must update the hand-written mirror types in the owning frontend module's `repositories/` bridge in the same change.
- MTS-ESP host support is absent; do not add registration or publication until its ownership and distribution contracts are settled.
- Command naming is snake_case; multi-command domains use a prefix (`collab_*`, `crumbs_*`, `link_*`).
