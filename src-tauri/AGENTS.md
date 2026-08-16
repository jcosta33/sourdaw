# src-tauri — Agent Guidelines

Tauri 2 desktop shell (lib `sourdaw_lib`; `src/main.rs` → `sourdaw_lib::run()`). A shell, not an implementation: every command body lives in `crates/sourdaw-native`, whose `AGENTS.md` governs it.

## Command surface

- Every command is registered in the single `tauri::generate_handler!` in `src/lib.rs` and declared under `src/commands/`, one file per domain. Managed state is registered in `src/lib.rs` alongside it.
- A command file holds transport and nothing else: unwrap managed state, raw invoke bodies, channels and the app handle, then call the body in `sourdaw-native`. A decision made here rather than there is a defect — it will not exist in the other shell.
- Where Tauri types are the behaviour — window creation, sidecar spawning, event emission, the raw-body invoke shape — the shell implements the corresponding `sourdaw-native` trait (`events.rs`, `windows.rs`, `sidecar.rs`, `commands/binary_ipc.rs`) instead of pushing the Tauri type inward.
- Naming: snake_case; multi-command domains use a prefix (`collab_*`, `crumbs_*`, `link_*`).
- IPC payload types are hand-maintained on both sides — no binding generator runs. A command signature change must update the hand-written mirror types in the owning module's `repositories/` bridge (e.g. `PluginHost/repositories/pluginBridge/`) in the same change.
- Frontend reaches commands **only** via `src/utils/tauriBridge.ts` from module-root `repositories/` (enforced by `tauri-ipc-only-in-repositories`). Bridge folders typically mirror command files (e.g. `PluginHost/repositories/pluginBridge/` ↔ `commands/plugins.rs`), but not every command file has a bridge.

## Real-time invariants (hard)

The audio-thread rules are stated once, in `crates/sourdaw-native/AGENTS.md`, and they bind this shell too: nothing reached from the CPAL callback may allocate, lock or emit, and the window, sidecar and event implementations here are all forbidden on that path.

## Constraints

- Plugin hosting is CLAP only — VST3/AU are not advertised or loadable. Ableton Link is an unsupported capability surface; no native Link library is linked.
- The plugin editor window is *owned* by the DAW window (`windows.rs`). Ownership is a destruction cascade as well as a z-order relationship, so the owner is the configured main window or nothing — never a window picked by label order.
- A shell that creates plugin editor windows must run the native crate's OS-close reset off its window-event thread. That thread is otherwise the only event-thread caller of the plugin mutexes and of the CLAP control lock, and doing the work inline risks a circular-wait deadlock with GUI-affine plugins.
- MTS-ESP host support is absent; do not add registration or publication until its ownership and distribution contracts are settled.
