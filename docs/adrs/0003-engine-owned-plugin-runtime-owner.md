---
type: adr
id: 0003
title: Give engine-owned native plugins a non-RT runtime owner
status: accepted
date: 2026-06-28
owner: The Sourdaw team
sources:
  - specs/plugin-hosting-clap/bug-engine-owned-plugin-runtime-control-path.md
---

# 0003 — Give engine-owned native plugins a non-RT runtime owner

## Context

When a CLAP plugin is loaded while the native engine is running, the live
`ClapWrapper` is moved into `ClapPluginSlot`, then into `daw-engine` scheduler
state. Tauri command state keeps only metadata and `engine_plugin_id`. Parameter
and unload commands can address that engine id, but state save/restore and native
editor lifecycle cannot reach the same live instance from non-RT code.

The rejected shortcuts are architectural failures: duplicate wrappers control a
different instance, `Arc<Mutex<ClapWrapper>>` puts a lock on the audio path, and
state/editor `GraphCommand`s would run allocation, serialization, or native
window work in the CPAL callback.

## Decision

Introduce a native plugin-host runtime owner/control actor for live hosted
plugin instances. The runtime owner owns the live CLAP wrapper and exposes two
separate surfaces:

- an RT-safe processing/parameter endpoint consumed by `daw-engine`;
- a slow-path control endpoint for Tauri commands to save/restore state, query
  capabilities, and open/close native editor windows.

The engine remains the audio runtime executor. It must not own plugin editor
lifecycle or plugin state serialization, and it must not drain slow control work
on the audio callback. Tauri remains a bridge over explicit DTO commands; no live
plugin handle crosses IPC.

Instantiation failure semantics: if a plugin slot is already project truth and
runtime instantiation fails, keep a visible non-processing error slot with retry
metadata. Do not silently drop the slot or overwrite saved plugin state.

## Non-goals

- Do not make Tauri command state the owner of live plugin handles.
- Do not run state serialization, deserialization, editor-window lifecycle, or
  other slow control work from the audio callback.
- Do not solve out-of-process plugin sandboxing in this ADR; this decision only
  establishes the in-process ownership/control boundary.

## Open questions

- Which concrete transport should the slow-path control endpoint use: a
  dedicated runtime thread with channels, a quiesce/transfer protocol, or an
  out-of-process host boundary?
- What is the exact suspend/resume behavior when a slow-path state operation
  needs exclusive plugin access while audio is running?
- Which failures leave a visible non-processing slot versus removing the runtime
  instance entirely?

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Duplicate `ClapWrapper` for state/editor commands | It controls a different instance than the one processing audio. |
| Share `ClapWrapper` with `Arc<Mutex<_>>` | The audio path would take a lock or coordinate with a lock-owning slow path. |
| Add state/editor graph commands drained by the scheduler callback | `get_state`, `set_state`, and editor lifecycle work allocate, serialize, or touch native windows. |
| Use the audio bridge as a control channel | The bridge carries audio blocks and is not an ownership/control protocol. |
| Transfer the boxed wrapper out of the scheduler for every slow operation | It can be a migration spike, but it keeps ownership centered in the scheduler and risks audible gaps unless a real suspend protocol exists. |

## Consequences

- Positive: one live plugin instance serves audio, state, parameters, and editor
  lifecycle without putting slow work on the RT callback.
- Negative: this is a real subsystem refactor across `daw-plugin-host`,
  `daw-engine`, and `src-tauri`; it needs tests and an explicit suspend/failure
  protocol before implementation.
- Neutral: parameter and unload commands that already work through
  `engine_plugin_id` become compatibility surfaces over the runtime owner rather
  than the final ownership model.

## Status

accepted

Accepted for implementation as part of the project's plugin-hosting runtime
work.

## Affected requirements

- `SPEC-plugin-hosting-clap#AC-001` — loaded plugin instances need stable lifecycle identity.
- `SPEC-plugin-hosting-clap#AC-007` — native plugin editor windows must open for loaded instances.
- `SPEC-plugin-hosting-clap#AC-010` — plugin state save/restore must address the loaded instance.
