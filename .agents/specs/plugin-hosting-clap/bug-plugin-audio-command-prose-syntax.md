---
type: bug
id: BUG-plugin-audio-command-prose-syntax
title: Plugin audio Tauri command contains raw prose in Rust code
status: fixed
owner: The Sourdaw team
sources:
  - .agents/findings/project-health-audit-2026-06-27.md
  - SPEC-plugin-hosting-clap
---

# Bug: Plugin audio Tauri command contains raw prose in Rust code

## Symptom

`process_plugin_audio` contains a plain English parenthetical line that is not a Rust comment. The current workspace compile is blocked earlier by `daw-core`, but this line is a syntax error candidate once earlier blockers clear.

## Reproduction

Inspect the command source:

```text
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:477:    // Try to pop processed output
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:478: (may be from previous block - 1 block latency)
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:479:    if let Some(output) = bridge.pop_output() {
```

The plugin-hosting spec requires the native bridge to avoid per-block IPC in the worklet path:

```text
.agents/specs/plugin-hosting-clap/spec.md:45:### AC-003 - SAB audio transport, no per-block IPC
.agents/specs/plugin-hosting-clap/spec.md:47:The native plugin bridge worklet must exchange audio via shared-memory ring buffers
.agents/specs/plugin-hosting-clap/spec.md:48:and a separate param queue, with zero `tauriInvoke` calls inside `process()`.
```

**Expected:** native plugin command code is valid Rust before any plugin-hosting verification can run.
**Actual:** line 478 is neither a comment nor code.
**Conditions:** Reproduced by source inspection on 2026-06-27 from the local `sourdaw` working tree. `cargo check --workspace` currently exits earlier on `crates/daw-core/src/tuning.rs`, so this exact parse failure has not yet been reached by the compiler in the current baseline.

## Root cause

A prose continuation of the preceding comment was inserted without `//`, leaving raw text inside the function body.

## Affected requirements

- `SPEC-plugin-hosting-clap#AC-003` - the bridge cannot be verified while its command implementation contains invalid Rust.
- `SPEC-plugin-hosting-clap#AC-011` - bridge ring/queue sizing work depends on a compiling native command surface.
- `SPEC-plugin-hosting-clap#AC-012` - under-run behavior cannot be tested until the plugin-hosting command path compiles.
