---
type: bug
id: BUG-tauri-audio-decode-commands-unregistered
title: Tauri audio decode commands are unregistered and mismatched with frontend calls
status: fixed
owner: The Sourdaw team
sources:
    - SPEC-chrome-first-capability
---

# Bug: Tauri audio decode commands are unregistered and mismatched with frontend calls

## Resolution

The unused native metadata path and its frontend-only adapter were removed. The live decode APIs remain in `daw-io` for file and byte decoding, and the WASM decoder continues to use the byte-decoding API. The filesystem command's separate `AudioFileInfo` remains owned by filesystem flows.

The earlier command-wiring mismatch is therefore no longer an active code path. The AudioEngine decode use-case tests cover the browser fallback orchestration, including re-reading the `File` after Web Audio detaches its first input. The `daw-io` and `daw-wasm-decoder` Rust crates currently execute zero tests under `cargo test`, so they are not cited as coverage evidence here.

## Affected requirements

- `SPEC-chrome-first-capability#AC-004` - resolved for this finding; the browser fallback orchestration is covered by focused AudioEngine decode tests.
- `SPEC-chrome-first-capability#AC-023` - resolved for this finding; the unused native metadata command surface is gone and filesystem operations remain separate.
- `SPEC-chrome-first-capability#AC-024` - superseded for this finding; no inactive command contract remains to document.
