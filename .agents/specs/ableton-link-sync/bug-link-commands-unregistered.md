---
type: bug
id: BUG-link-commands-unregistered
title: Ableton Link commands are defined but not registered in Tauri
status: fixed
owner: The Sourdaw team
sources:
  - "Transient finding: project-health-audit-2026-06-27"
  - SPEC-ableton-link-sync
---

# Bug: Ableton Link commands are defined but not registered in Tauri

## Symptom

The frontend Link bridge can call Tauri command names that the desktop invoke handler does not expose. Even if registered, the current command bodies only toggle local stub state and do not drive `rusty_link`.

## Reproduction

1. Confirm the spec requires real Link behavior:

```text
.agents/specs/ableton-link-sync/spec.md:27:### AC-001 - Tempo tracks a Link peer
.agents/specs/ableton-link-sync/spec.md:34:### AC-002 - Quantized start alignment
.agents/specs/ableton-link-sync/spec.md:41:### AC-003 - Clean disable
```

2. Confirm Link commands exist in Rust:

```text
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/mod.rs:7:pub mod link;
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/link.rs:44:pub async fn enable_link(...)
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/link.rs:63:pub async fn disable_link(...)
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/link.rs:71:pub async fn set_link_tempo(...)
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/link.rs:80:pub async fn get_link_status(...)
```

3. Confirm `src-tauri/src/lib.rs` manages no `LinkState` and registers no `commands::link::*` entries in `tauri::generate_handler!`:

```text
/Users/josecosta/dev/sourdaw/src-tauri/src/lib.rs:9:    tauri::Builder::default()
/Users/josecosta/dev/sourdaw/src-tauri/src/lib.rs:10:        .manage(state::AppState::default())
/Users/josecosta/dev/sourdaw/src-tauri/src/lib.rs:19:        .invoke_handler(tauri::generate_handler![
/Users/josecosta/dev/sourdaw/src-tauri/src/lib.rs:103:            commands::tuning::parse_scl,
```

4. Confirm the frontend Link bridge has its own Tauri detection path:

```text
/Users/josecosta/dev/sourdaw/src/modules/AudioEngine/repositories/linkBridge/helpers.ts:16:export function isTauri(): boolean {
/Users/josecosta/dev/sourdaw/src/modules/AudioEngine/repositories/linkBridge/helpers.ts:17:    return typeof window !== 'undefined' && '__TAURI__' in window;
/Users/josecosta/dev/sourdaw/src/utils/tauriBridge.ts:18:export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
```

**Expected:** the desktop app registers Link state and commands, and enabling Link connects to the native Link runtime required by the spec.
**Actual:** the commands are present as source files but absent from the invoke handler and state manager.
**Conditions:** Reproduced by source inspection on 2026-06-27 from the local `sourdaw` working tree.

## Root cause

`src-tauri/src/commands/mod.rs:7` declares the Link module, but `src-tauri/src/lib.rs:9-104` does not call `.manage(commands::link::LinkState::default())` and does not include any `commands::link::*` functions in `generate_handler!`. The command bodies at `src-tauri/src/commands/link.rs:48-49` also leave actual `rusty_link` integration as comments.

## Affected requirements

- `SPEC-ableton-link-sync#AC-001` - Tempo cannot track a Link peer if Link commands are not reachable and only update local stub state.
- `SPEC-ableton-link-sync#AC-002` - Quantized peer start alignment is not implemented by the current stub.
- `SPEC-ableton-link-sync#AC-003` - Clean disable cannot be verified through the desktop bridge while the commands are unregistered.
