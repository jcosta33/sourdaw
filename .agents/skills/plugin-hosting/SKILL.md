---
name: plugin-hosting
type: agent-guide
description: >-
  Isolate native plugin hosting as a subsystem with separable concerns:
  scanning, instantiation, editor windows, RT-safe processing, and failure
  recovery. ALWAYS apply this skill when implementing or reviewing plugin
  scanning, plugin metadata, instance lifecycle, plugin editor windows,
  host/plugin communication, or plugin-host failure handling — even if the
  change looks like a small lifecycle or editor-window tweak. Do not store live
  plugin instances in project truth, embed vendor editors in the webview, run
  scan or window work on the audio thread, or make the vendor GUI the only
  control path. Skip this skill for built-in DSP device authoring, general
  audio-engine/transport work, or non-plugin window management.
---

# Skill: plugin-hosting

## Purpose

Plugin hosting is a subsystem, not a convenience layer — it combines scanning,
discovery, metadata caching, capability reporting, instance lifecycle,
GUI/editor lifecycle, RT-safe processing, parameter/control flow, host/plugin
thread boundaries, platform-specific native behavior, and failure recovery. The
failure mode this skill prevents is collapsing those concerns together: a "plugin
manager" abstraction that scans files *and* holds live instances *and* drives
editor windows *and* touches the audio thread, where one third-party crash or one
GUI quirk corrupts project truth or stalls the RT path. This skill keeps plugin
hosting isolated, RT-safe, and aligned with the DAW's project/runtime split.

## Project context (the AGENTS.md contract)

This is a conceptual architecture guide; it prescribes no project commands of its
own. The self-review gate below resolves verification commands from the consuming
repo commands — `pnpm typecheck`, `pnpm lint`, `pnpm deps:validate`,
`pnpm test:run` (and `cargo test` for Rust crates). If a command is unclear, ask which
command to run before claiming a check passed — do not guess.

## Core rules

### 1. Project-side plugin state is not runtime-side plugin state

Project truth may store: plugin identity, slot/order placement, configured
parameter values, preset references, bypass state, automation targets, and saved
plugin-specific metadata that belongs to the project. Runtime/plugin-host state
may store: the live plugin instance, the native handle, the editor window,
processing buffers, host-side communication channels, scan/runtime caches, and
crash-isolation state. Do not conflate these.

_Why: project truth is serialized, shared, and long-lived; a live native handle
or editor window is none of those. Putting a runtime instance in project truth
makes the save format depend on a third-party plugin being loaded._

### 2. Plugin hosting is a subsystem with separable concerns

Treat these as distinct concerns: (1) discovery, (2) scan metadata, (3)
capability reporting, (4) instantiation, (5) parameter inspection, (6) state
save/restore, (7) editor window management, (8) audio processing, (9)
crash/failure isolation. If one abstraction owns too many of these, it is
probably wrong. The expanded per-phase boundaries are in
[`references/lifecycle-phases.md`](./references/lifecycle-phases.md).

_Why: each concern fails, scales, and threads differently — scanning is
filesystem-bound and cacheable, processing is RT-bound and allocation-free,
editors are UI-bound. A single abstraction forces them onto one failure and
threading model and breaks all of them at once._

### 3. Third-party plugin GUIs belong in native windows

Do not embed native plugin editors inside the webview UI. Default model: the DAW
UI in the webview, the plugin editor in separate native window(s).

_Why: native plugin editors expect a native window handle and their own event
loop; forcing them into the webview breaks rendering, input, and platform GUI
contracts, and couples a crash-prone third-party surface to the app shell._

### 4. Hosting must remain RT-safe

GUI interaction, scanning, metadata reading, and editor management are not
audio-thread work. RT-sensitive plugin communication must use RT-safe paths. The
forbidden-on-RT list and the fast/slow-path split are rules 7 and 8.

_Why: the audio thread has a hard real-time deadline; any allocation, lock,
window op, or blocking IPC on it produces audible dropouts regardless of how rare
it is._

### 5. Hosted plugins and built-in devices converge conceptually where possible

Even if the runtime implementations differ, preserve a common conceptual surface
for: parameters, automation targets, presets, bypass, routing participation, and
instance identity.

_Why: a shared conceptual surface lets automation, the generic inspector, and
preset/state code treat a hosted plugin and a built-in device the same way —
without it, every consumer needs two code paths and the DAW feels inconsistent._

### 6. Plugin editors are runtime/UI bridges, and never the only control surface

Opening, sizing, focusing, or closing an editor is runtime/UI behavior, not
project truth — do not let editor lifecycle leak into saved project truth unless
explicitly designed and modeled. Separately, host-visible parameters must remain
available for automation, generic inspector control, preset/state persistence,
modulation, and accessibility/fallback workflows. Parameter surfaces stay
host-visible whenever possible; do not make vendor GUIs the only control path.

_Why: if the vendor GUI is the only way to change a value, then automation,
modulation, presets, and accessibility all silently stop working for that
plugin — and a closed editor means an uncontrollable plugin._

### 7. Never on RT-sensitive paths

Do not do any of these on audio-thread-sensitive plugin paths: allocate
unpredictably, lock, open windows, scan plugins, perform filesystem work, parse
heavy metadata, call UI code, call shell event loops, or do blocking IPC.

_Why: every item on this list has unbounded or unpredictable latency; the RT
path's deadline is fixed, so any one of them risks a missed buffer and an audible
glitch._

### 8. Separate the fast path from the slow path

Fast path (RT): parameter updates, sample-accurate control, RT-safe buffer
processing. Slow path (not RT): scan/discovery, instantiate/unload, editor
lifecycle, metadata refresh, failure-recovery workflows. Keep them in distinct
code paths.

_Why: mixing slow-path work into the fast path is how RT violations sneak in;
an explicit boundary makes the violation obvious in review instead of latent._

### 9. Assume failure is normal; never silently corrupt project truth

Plan for plugin load failure, scan failure, missing capabilities, editor creation
failure, unsupported formats, runtime crash/hang, state restore failure, and
platform-specific GUI issues. Above all, failures must not silently corrupt
project truth. The full catalogue and isolation expectations are in
[`references/failure-catalogue.md`](./references/failure-catalogue.md).

_Why: plugin hosting is the subsystem most exposed to third-party,
out-of-process, and platform-specific behavior, so failure is the common case,
not the edge case — un-planned failure is how a single bad plugin loses a user's
project._

### 10. Instantiation failure semantics must be explicit

If a plugin is added in project truth but runtime instantiation fails, define
explicitly — in the design, not by accident — whether the project mutation rolls
back, the slot remains with an error state, or the failure is recoverable via
retry. Do not leave this ambiguous.

_Why: an undefined answer here is the exact path by which a load failure silently
corrupts project truth — the slot exists in the save file but nothing decided what
it means._

## What does not belong

- **Live plugin instances or native handles in project truth or shared UI state.**
  Those are runtime/plugin-host state (rule 1). Project truth holds identity,
  placement, and configured values only.
- **Editor window state saved as project truth.** Editor lifecycle is a runtime/UI
  bridge (rule 6) unless intentionally modeled.
- **Scanning logic fused with the live host.** Discovery/metadata is a separate
  concern from live instance management (rule 2).
- **Built-in DSP device authoring.** That is device-implementation work, not
  hosting — covered by the audio-engine guidance, not this skill.
- **General transport/routing/scheduling RT code.** This skill covers the RT rules
  *as they apply to hosted plugins*; the engine's own RT architecture lives with
  `../web-audio-engine/SKILL.md` (if installed).

## Refuses — temptation → do instead

| 🚩 Temptation | ✅ Do instead |
| --- | --- |
| Store the live plugin instance / native handle in app truth or shared UI state | Runtime/plugin-host owns live instances; project truth stores only identity, placement, and configured values |
| Auto-save runtime editor UI state (position, focus) as project truth | Keep editor lifecycle runtime/UI unless intentionally modeled as project truth |
| Build one abstraction that scans files *and* acts as the live host | Separate metadata/discovery from live instance management |
| Ship a plugin that is meaningfully controllable only through its vendor GUI | Keep host-visible parameter surfaces explicit and available |
| Let audio-thread-sensitive logic call editor or native-window operations | Isolate RT processing from all GUI/window concerns completely |
| Model built-in and hosted plugins in totally incompatible ways | Align automation/parameter/preset/bypass semantics where practical, even if runtimes differ |
| Leave "what happens when instantiation fails" undecided | Pick rollback / error-slot / retry explicitly and document it |
| Scan, allocate, lock, or open a window on the audio thread | Move it to the slow path; the fast path only does RT-safe parameter and buffer work |

## Anti-patterns

1. **Plugin instance in general app truth** — a live instance or native handle
   stored in app truth or shared UI state instead of the plugin-host runtime.
2. **Editor window treated as project semantics** — runtime editor UI state
   automatically persisted as project truth.
3. **Scanning and hosting collapsed together** — one abstraction both scans files
   and acts as the live host.
4. **GUI path becomes the control path** — a plugin is meaningfully controllable
   only through its vendor GUI, with no host-visible parameter surface.
5. **RT path calls UI/window logic** — audio-thread-sensitive logic depends on
   editor or native-window operations.
6. **Built-in and hosted plugins modeled in totally incompatible ways** — no
   shared conceptual surface for automation/parameters/presets.

## Self-review gate

Run this before declaring plugin-hosting work complete. Any check that produces
output must have that output pasted verbatim — a claim without pasted output reads
as unverified, not Pass. **Not complete until the answer to every question below
is written down and the four command pastes appear verbatim in the self-review.**

1. Is project-side state separate from runtime instance state? (rule 1)
2. Are discovery, scanning, instantiation, editor lifecycle, and processing
   reasonably separated? (rule 2)
3. Are plugin GUIs handled as native runtime windows rather than webview embeds?
   (rule 3)
4. Are RT-sensitive paths lock-free and side-effect disciplined? (rules 4, 7, 8)
5. Are host-visible parameter surfaces preserved? (rule 6)
6. Are failures explicit and recoverable, with instantiation-failure semantics
   decided? (rules 9, 10)
7. Did the change reduce or increase coupling between UI, truth, and runtime
   instances? State which.

Then paste verbatim output for each:

- `pnpm typecheck` — types are sound (no `any`/`as` escapes at the new boundaries).
- `pnpm lint` — static checks clean.
- `pnpm deps:validate` — dependency-boundary validation (known baseline may ignore debt;
  new hits still fail).
- `pnpm test:run` and/or `cargo test` for touched paths.

A claim without pasted output reads Unverified, not Pass.

## Bundled resources

- [`references/lifecycle-phases.md`](./references/lifecycle-phases.md) — the nine
  separable concerns expanded (per-phase: what it does, what it must not absorb,
  and its project-vs-runtime boundary).
- [`references/failure-catalogue.md`](./references/failure-catalogue.md) — the
  full failure-mode table, the explicit instantiation-failure semantics, and the
  isolation expectations.
