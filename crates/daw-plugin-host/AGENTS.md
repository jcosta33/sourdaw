# crates/daw-plugin-host — Agent Guidelines

Native CLAP audio plugin hosting, parameter mapping, state serialization, and GUI window embedding lifecycle.

## Domain Ownership

- Owns CLAP plugin instantiation, parameter enumeration, preset loading, and host extension bindings (`clap-sys`, `libloading`).
- Owns plugin scan policies and child-process worker isolation (`plugin_scan_worker`).
- Does not own built-in device DSP (`daw-dsp`), timeline clip sequencing (`Arrangement`), or Electron IPC routing (`electron/`).

## Invariants & Constraints

- **CLAP Only**: Sourdaw hosts CLAP plugins exclusively (ADR 0031). Non-CLAP formats (VST2/VST3/AU) are rejected by name with explicit reasons.
- **Scan Policy & Worker Isolation**: Plugin scanning requires absolute paths; symlinks are rejected. Executing untrusted plugin binaries during discovery must run in the bounded `plugin_scan_worker` child process—never load plugin entrypoints directly in the main app process.
- **Audio Thread Safety**: Real-time plugin audio processing must avoid heap allocation and mutex locks. If non-RT control locks a plugin mutex, the audio thread bypasses it rather than blocking.
- **Retirement Queue**: Destroyed plugin runtimes are queued in a retirement structure and released on a background thread—never drop plugin runtimes on the audio thread.

## Verification

```bash
cargo test --package daw-plugin-host
```
