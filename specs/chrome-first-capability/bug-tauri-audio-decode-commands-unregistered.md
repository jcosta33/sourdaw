---
type: bug
id: BUG-tauri-audio-decode-commands-unregistered
title: Tauri audio decode commands are unregistered and mismatched with frontend calls
status: fixed
owner: The Sourdaw team
sources:
  - inventory/project-health-audit-2026-06-27.md
  - SPEC-chrome-first-capability
---

# Bug: Tauri audio decode commands are unregistered and mismatched with frontend calls

## Symptom

The Tauri audio decode repository path can invoke command names and argument shapes that the Rust desktop command surface does not expose.

## Reproduction

1. Confirm Rust declares audio decode commands:

```text
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/mod.rs:2:pub mod audio_decode;
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/audio_decode.rs:6:pub async fn decode_audio_file(file_path: String) -> Result<DecodedAudio, String> {
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/audio_decode.rs:12:pub async fn get_audio_file_metadata(file_path: String) -> Result<AudioStreamMeta, String> {
```

2. Confirm the invoke handler registers no `commands::audio_decode::*` functions:

```text
/Users/josecosta/dev/sourdaw/src-tauri/src/lib.rs:19:        .invoke_handler(tauri::generate_handler![
/Users/josecosta/dev/sourdaw/src-tauri/src/lib.rs:42:            commands::filesystem::read_audio_file,
/Users/josecosta/dev/sourdaw/src-tauri/src/lib.rs:103:            commands::tuning::parse_scl,
```

3. Confirm frontend command names and argument keys do not match the Rust function names/signatures:

```text
/Users/josecosta/dev/sourdaw/src/modules/AudioEngine/repositories/audioDecoding/tauriDecoding/decodeAudioFile.ts:37:    const raw = (await tauriInvoke('decode_audio_file', { path })) as RustDecodedAudio;
/Users/josecosta/dev/sourdaw/src/modules/AudioEngine/repositories/audioDecoding/tauriDecoding/getAudioFileInfo.ts:50:    const raw = (await tauriInvoke('get_audio_file_info', { path })) as RustAudioFileInfo;
```

**Expected:** frontend command names and argument shapes match registered Rust Tauri commands.
**Actual:** `decode_audio_file` is not registered and receives `{ path }` while Rust expects `file_path`; `get_audio_file_info` has no matching Rust command, and Rust's `get_audio_file_metadata` is unregistered.
**Conditions:** Reproduced by source inspection on 2026-06-27 from the local `sourdaw` working tree.

## Root cause

`src-tauri/src/commands/audio_decode.rs` was added as a command module, but `src-tauri/src/lib.rs` never added it to `generate_handler!`. The TypeScript adapter independently chose command names and payload keys instead of sharing a generated or tested command contract.

## Affected requirements

- `SPEC-chrome-first-capability#AC-004` - audio platform operations are not currently mediated by one verified adapter contract.
- `SPEC-chrome-first-capability#AC-023` - the Tauri decode path has independent platform wiring instead of using the shared bridge shape.
- `SPEC-chrome-first-capability#AC-024` - the current decode command shape passes raw paths rather than opaque IDs.
