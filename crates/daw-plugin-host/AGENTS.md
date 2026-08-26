# crates/daw-plugin-host — Agent Guidelines

Native audio plugin hosting, parameter mapping, state serialization, and GUI window embedding lifecycle.

## Domain Ownership

- Owns plugin instantiation, parameter enumeration, preset loading, and host callback implementations for every hosted format (`clap-sys`, `vst3`, `libloading`).
- Owns plugin scan policies and child-process worker isolation (`plugin_scan_worker`).
- Does not own built-in device DSP (`daw-dsp`), timeline clip sequencing (`Arrangement`), or Electron IPC routing (`electron/`).

## Invariants & Constraints

- **One seam per format**: A format is hosted through the shared `AudioPlugin` / `HostedPluginRuntime` seam and dispatched by `HostedRuntime`, never by a second code path beside it. A format Sourdaw does not host is refused by name with its reason (ADR 0031); it is never advertised, and it never reaches a loader.
- **Format answers come from the plugin**: A capability the host publishes — MIDI acceptance, port counts, an editor — is the plugin's own answer for that format, never a constant standing in for one. A value the host could not ask for is published with the reason it could not.
- **Trademark**: VST is a registered trademark of Steinberg Media Technologies GmbH. Prose that names the format carries the attribution; no Steinberg logo ships.
- **Scan Policy & Worker Isolation**: Plugin scanning requires absolute paths; symlinks are rejected. Executing untrusted plugin binaries during discovery must run in the bounded `plugin_scan_worker` child process—never load plugin entrypoints directly in the main app process.
- **Audio Thread Safety**: Real-time plugin audio processing must avoid heap allocation and mutex locks. If non-RT control locks a plugin mutex, the audio thread bypasses it rather than blocking.
- **Retirement Queue**: Destroyed plugin runtimes are queued in a retirement structure and released on a background thread—never drop plugin runtimes on the audio thread.
- **Thread-affine lifecycle calls**: A format's own threading rules bind the host. VST3 `setActive` is UI-thread only and `setProcessing` is the sole lifecycle call the audio thread may make; both formats route through the shared `ProcessingGate` rather than a private state machine.

## Verification

```bash
cargo test --package daw-plugin-host
```
