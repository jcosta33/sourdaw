---
type: bug
id: BUG-engine-loaded-plugin-instances-not-registered
title: Engine-loaded CLAP instances are missing from plugin command state
status: partial
owner: The Sourdaw team
sources:
  - SPEC-plugin-hosting-clap
---

# Bug: Engine-loaded CLAP instances are missing from plugin command state

## Symptom

When a CLAP plugin is loaded while the native engine is running, the wrapper is moved into the engine and an audio bridge is registered, but the returned `PluginInstance` is not registered in `state.plugins`. Later commands that use the returned `instance_id` look only in `state.plugins`, so parameter changes, unload, and native GUI open fail with "No plugin instance".

## Reproduction

Inspect the CLAP load branch and follow-up command lookups:

```text
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:164:            let engine_plugin_id = {
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:169:                if let Some(ref mut engine) = *engine_guard {
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:170:                    let slot = ClapPluginSlot::new(wrapper);
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:171:                    let id = engine.add_plugin(Box::new(slot))?;
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:186:                    let mut plugins = state
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:190:                    plugins.insert(
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:256:    if plugins.remove(&instance_id.0).is_none() {
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugins.rs:281:    let instance = plugins
/Users/josecosta/dev/sourdaw/src-tauri/src/commands/plugin_gui.rs:61:        let instance = plugins
```

**Expected:** every returned native plugin `instance_id` resolves for parameter, unload, state, and GUI commands regardless of whether the native engine was already running.
**Actual:** the engine-running CLAP branch inserts into `state.audio_bridges` but only the engine-not-running fallback inserts into `state.plugins`.
**Conditions:** Source inspection on 2026-06-27.

## Root cause

The native plugin lifecycle has two state owners: the audio engine owns engine-loaded CLAP instances, while command handlers and GUI code still use the older `state.plugins` map as the instance registry.

## Affected requirements

- `SPEC-plugin-hosting-clap#AC-001` - loaded plugin instances need stable lifecycle identity.
- `SPEC-plugin-hosting-clap#AC-005` - parameter automation/control cannot address engine-loaded CLAP instances through the returned ID.
- `SPEC-plugin-hosting-clap#AC-007` - native plugin editor windows cannot open for engine-loaded instances.

## Split status

`TASK-artifact-native-command-lifecycle` fixes the mergeable lifecycle slice: returned engine-loaded `instance_id`s resolve for parameter, parameter-query, and unload commands, alongside command registration and LAN browsing lifecycle fixes.

The remaining state/editor half is tracked by `BUG-engine-owned-plugin-runtime-control-path` and `TASK-artifact-engine-owned-plugin-runtime-control-path`. That follow-up requires a real plugin-host runtime owner/control path; duplicate wrappers, mutex-shared wrappers on the audio path, and state/editor graph commands drained by the CPAL callback are explicitly rejected.

Current state: partial. The parameter/unload slice is integrated in
`artifact-remediation-integration`; state/editor support remains blocked on
`.agents/decisions/0003-engine-owned-plugin-runtime-owner.md`.
