---
type: bug
id: BUG-tauri-audio-decode-commands-unregistered
title: Tauri audio decode commands are unregistered and mismatched with frontend calls
status: fixed
owner: The Sourdaw team
sources:
  - "Transient finding: project-health-audit-2026-06-27"
  - SPEC-chrome-first-capability
---

# Bug: Tauri audio decode commands are unregistered and mismatched with frontend calls

## Resolution

The unused native metadata path and its frontend-only adapter were removed. The live decode APIs remain in `daw-io` for file and byte decoding, and the WASM decoder continues to use the byte-decoding API. The filesystem command's separate `AudioFileInfo` remains owned by filesystem flows.

The earlier command-wiring mismatch is therefore no longer an active code path. The remaining audio decode behavior is covered by the AudioEngine WASM decode tests and the `daw-io` and `daw-wasm-decoder` Rust test suites.

## Affected requirements

- `SPEC-chrome-first-capability#AC-004` - resolved for this finding; the live decode paths are covered by focused tests.
- `SPEC-chrome-first-capability#AC-023` - resolved for this finding; the unused native metadata command surface is gone and filesystem operations remain separate.
- `SPEC-chrome-first-capability#AC-024` - superseded for this finding; no inactive command contract remains to document.
