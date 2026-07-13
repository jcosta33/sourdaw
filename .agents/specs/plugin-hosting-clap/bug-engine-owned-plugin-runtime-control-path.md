---
type: bug
id: BUG-engine-owned-plugin-runtime-control-path
title: Engine-owned CLAP instances lack a non-RT state/editor control path
status: blocked
owner: The Sourdaw team
sources:
  - BUG-engine-loaded-plugin-instances-not-registered
  - .agents/decisions/0003-engine-owned-plugin-runtime-owner.md
  - REVIEW-artifact-native-command-lifecycle
  - TASK-artifact-native-command-lifecycle
---

# Bug: Engine-owned CLAP instances lack a non-RT state/editor control path

## Symptom

When a CLAP plugin is loaded while the native engine is running, the live `ClapWrapper` is moved into `daw-engine` as a `ClapPluginSlot`. Command handlers can now address that instance for parameter changes and unload through `engine_plugin_id`, but state and native editor commands cannot reach the same live wrapper.

## Reproduction

Inspect the engine-running CLAP load path and follow-up command lookups:

```text
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:159:            let wrapper = ClapWrapper::new(&entry.path, &clap_id, sample_rate)?;
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:171:                    let slot = ClapPluginSlot::new(wrapper);
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:172:                    let id = engine.add_plugin(Box::new(slot))?;
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:186:                    engine_plugins.insert(
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:426:        return Err(format!(
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:459:        return Err(format!(
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugin_gui.rs:78:                    return Err(format!(
```

`engine_plugins` stores only the engine id, name, and a parameter snapshot. The live plugin is boxed inside the scheduler, and `EngineHandle` exposes only graph commands intended for RT-safe control.

**Expected:** state restore/save and native editor commands for an engine-owned plugin instance resolve to the same live CLAP instance that processes audio, from a non-RT path.
**Actual:** state/editor commands either look in the old command-side plugin map or explicitly reject engine-owned instances.
**Conditions:** Source inspection on 2026-06-28 after `artifact-native-command-lifecycle` follow-up review.

## Non-solutions rejected

- Do not create a second `ClapWrapper` for state/editor commands. That would address a different plugin instance than audio processing.
- Do not share the `ClapWrapper` through `Arc<Mutex<_>>` with the scheduler. That would put a lock on the audio processing path.
- Do not add state/editor `GraphCommand`s drained by the CPAL callback. `get_state`, `set_state`, and editor lifecycle calls allocate or touch native windows and are not RT-safe.
- Do not use the audio bridge as a control channel. It carries audio buffers, not plugin control ownership.

## Root cause

Plugin hosting currently has two ownership models:

- command-side instances in `state.plugins`, which can serve state and editor commands but do not process in the native engine path;
- engine-owned instances in `daw-engine`, which process audio but have no non-RT control owner for state/editor work.

The missing abstraction is a plugin-host runtime owner or control thread that lets audio processing, state save/restore, and native editor lifecycle address one live instance without blocking or allocating on the audio callback.

## Affected requirements

- `SPEC-plugin-hosting-clap#AC-001` - loaded plugin instances need stable lifecycle identity.
- `SPEC-plugin-hosting-clap#AC-007` - native plugin editor windows must open for loaded instances.
- `SPEC-plugin-hosting-clap#AC-010` - plugin state save/restore must address the loaded instance.

## Split note

`TASK-artifact-native-command-lifecycle` fixes the immediately mergeable command lifecycle slice: Tauri command registration, LAN browsing lifecycle, and engine-owned parameter/unload addressability. This bug owns the remaining state/editor control path.

Current state: blocked. Proposed decision
`.agents/decisions/0003-engine-owned-plugin-runtime-owner.md` names the runtime-owner
architecture that must be accepted before implementation.
