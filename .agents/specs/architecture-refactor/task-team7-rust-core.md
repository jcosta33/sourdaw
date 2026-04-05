# Task Tracking: Team 7 — Rust Core Migration

## Status

Done — all scope items complete, build verified clean.

## Crate checklist

| Crate                     | Status | Notes                                                            |
| ------------------------- | ------ | ---------------------------------------------------------------- |
| `crates/daw-dsp/`         | done   | Clean WASM + native DSP library. No violations.                  |
| `crates/daw-core/`        | done   | Clean. IDs and newtypes only. serde + specta.                    |
| `crates/proof-chamber/`   | done   | Clean WASM reverb crate. Correct scoping.                        |
| `crates/scoring/`         | done   | Clean WASM tuner/pitch crate. Correct scoping.                   |
| `crates/daw-io/`          | done   | Populated with `audio_decode` module (symphonia).                |
| `crates/daw-plugin-host/` | done   | Fully populated from src-tauri/src/host/.                        |
| `crates/daw-collab/`      | done   | Assessed — keep separate (automerge + mdns-sd justify boundary). |
| `crates/daw-engine/`      | done   | RT engine clean. Removed unused clap-sys + libloading deps.      |
| `src-tauri/src/`          | done   | Commands thinned. host/ slimmed to native_bridge only.           |

## Findings

### Critical — fixed in this session

**F1: Plugin host code in src-tauri** _(fixed)_

- `src-tauri/src/host/` contained full CLAP/VST3 host implementation that belongs in `daw-plugin-host`.
- Moved: `traits.rs`, `clap_host_impl.rs → clap_host.rs`, `clap_wrapper.rs`, `vst3_wrapper.rs`, `scanner.rs`.
- `src-tauri/src/host/` now contains only `native_bridge.rs`.

**F2: Circular PluginParameter dependency** _(fixed)_

- `host/traits.rs` and `host/clap_wrapper.rs` both imported `PluginParameter` from `commands::plugins`.
- `PluginParameter` moved to `daw-plugin-host/src/params.rs` with `serde + specta::Type` derives.
- `commands/plugins.rs` re-exports it as `pub use daw_plugin_host::PluginParameter`.

**F3: Audio decode logic in a Tauri command** _(fixed)_

- `commands/audio_decode.rs` contained symphonia decoding logic that belongs in `daw-io`.
- Decode functions moved to `daw-io/src/audio_decode.rs`.
- `commands/audio_decode.rs` is now a thin wrapper calling `daw_io::decode_audio_file()`.

**F4: Unused deps in daw-engine** _(fixed)_

- `clap-sys` and `libloading` were in `daw-engine/Cargo.toml` but unused in source.
- Removed.

### Non-critical — fixed in a follow-up pass

**F5: RT violations in ClapPluginSlot and ClapWrapper** _(fixed)_

- `ClapPluginSlot::process_with_events()` was allocating `Vec<(u8, u8, i16, bool)>` per block → replaced with a stack array `[(u8, u8, i16, bool); MAX_MIDI_EVENTS]`.
- `ClapWrapper::process_with_midi()` was allocating `Vec<clap_event_note>` per block → replaced with `midi_scratch: Vec<clap_event_note>` preallocated in `ClapWrapper::new()`, cleared and reused each call.
- `ClapWrapper::process_audio_internal()` and `ClapPluginSlot::process_audio()` were using temporary Vecs for I/O buffers → replaced with `Box<[[f32; MAX_BUFFER]; 2]>` scratch fields.
- `Vst3PluginSlot::process_audio()` was a true no-op passthrough — no allocation, correct.
- All RT violations in the audio callback path have been resolved.

## Open questions

- None blocking — all architectural decisions made and documented.

## Architectural decisions

**daw-collab: keep as separate crate.**
Dependency boundary justified: automerge (CRDT), mdns-sd (LAN discovery), hostname. These have no overlap with any other crate. Collapsing into daw-core would pull heavy deps into the foundation crate.

**No daw-llm crate.**
LLM/AI capabilities (whisper-rs, mistralrs, ort/ONNX, sidecar) are native platform capabilities. They are appropriately thin Tauri commands. If inference logic grows significantly, a `daw-ai` crate would be warranted, but the current implementation has no extractable business logic.

**native_bridge.rs stays in src-tauri.**
`native_bridge.rs` is the adapter between `daw-plugin-host` (scanning/loading/GUI lifecycle) and `daw-engine` (RT NativePlugin trait). That adapter role correctly belongs at the Tauri integration layer, not inside either subsystem.

**PluginParameter lives in daw-plugin-host.**
It is a plugin parameter DTO — not a domain type (doesn't go in daw-core) and not a command DTO (shouldn't be defined in src-tauri). Defined in `daw-plugin-host/src/params.rs` with specta derive for TypeScript generation.

## Notes

- src-tauri no longer directly depends on `clap-sys` or `libloading` (moved to daw-plugin-host).
- `vst3` crate remains in src-tauri Cargo.toml (was already there, unused, left for future VST3 COM implementation).
- Dead host files deleted: `src-tauri/src/host/{traits,clap_wrapper,vst3_wrapper,clap_host_impl,scanner}.rs`. Only `native_bridge.rs` remains.
- `daw-llm` crate does not exist in the workspace — correct, as assessed. LLM/AI capabilities stay as Tauri commands.
- `stable_id` in scanner.rs now uses SHA-256 (sha2 crate) — deterministic across Rust versions.
- `PluginParameter::unit` is `Option<String>` — CLAP does not expose units in clap_param_info.
- `ClapWrapper::new()` requires `sample_rate: f64` — callers query cpal for the real device rate.
