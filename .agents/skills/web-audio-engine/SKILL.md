---
name: web-audio-engine
type: agent-guide
description: >-
  Architect browser-side audio as a real-time-safe runtime executor over one AudioContext. ALWAYS
  apply this skill when touching transport timing, clip scheduling, routing or buses, automation,
  worklet processors, metering taps, offline rendering, or any low-latency audio path — even if it
  looks like a small parameter tweak or a UI hook reading a meter. Do not store AudioContext/node/
  worklet handles in React state, mix or schedule audio on the main thread, or rebuild the graph on
  a parameter change directly. Skip this skill for non-audio UI work, project-state and persistence
  design, AI intent parsing, or native/Tauri concerns.
---

# Skill: web-audio-engine

## Purpose

This skill keeps the browser audio engine correct, fast, deterministic, and architecturally
aligned. The failure mode it prevents: the engine drifting into a second source of truth —
holding `AudioContext`/node handles in React state, mixing audio on the main thread, rebuilding
the graph on every fader move, or letting the UI own playback time — which makes audio glitch,
stall under load, and become impossible to reason about.

The engine **is** the runtime executor for playback and processing, the owner of live timing
and transport execution, the owner of browser-side graph topology and worklet lifecycle, and a
derived projection of authoritative project state. It is **not** a UI concern, a global state
bucket, a convenience layer for random audio operations, or a second source of truth.

## Project context (the AGENTS.md contract)

Use this repo's commands: `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm deps:validate`,
`pnpm build`. Do not invent substitutes. RT-audio code must not allocate or block (a
project-wide invariant). Module boundaries for engine code: `architecture` +
`architecture-violations`.

## Core rules

### 1. Use one live `AudioContext`

Root the live engine in a single `AudioContext`. Use it for source nodes, worklet nodes, buses,
automation targets, metering taps, monitor outputs, and built-in devices. Do not create separate
contexts for unrelated features (mixer, transport, preview playback, metering, plugin wrappers).
Use explicit separate offline contexts only for offline render/export workflows.

_Why: multiple live contexts cannot share a clock or a graph, so they drift, double-allocate
hardware buffers, and make sample-accurate timing impossible._

### 2. Use `AudioWorklet` for custom real-time DSP

Any custom low-latency DSP must run in `AudioWorklet`: gain/pan utility processors, metering
taps, clip playback/mixing helpers, sample-accurate automation application, low-latency analysis,
custom filters/processors, buffer-domain utilities. Do not use `ScriptProcessorNode`.

_Why: `ScriptProcessorNode` runs on the main thread and is deprecated; worklets run on the audio
render thread, which is the only place DSP can meet the deadline without glitching._

### 3. Use `AudioParam` whenever possible

When a value can be driven with `AudioParam`, prefer it — gain, pan, filter cutoff/resonance,
envelope-driven parameters, time-varying FX parameters, automation targets. Do not simulate
sample-accurate control with React state, UI timers, or arbitrary polling loops.

_Why: `AudioParam` is scheduled on the audio thread with sample accuracy; main-thread timers are
quantised to frame cadence and jitter, so they can never be sample-accurate._

### 4. Separate parameter changes from topology changes

This distinction is critical and assigns work to a path. Parameter changes (fader, pan,
mute/bypass, automation values, modulation, device parameter updates) take fast paths and must
**not** rebuild the graph. Topology changes (add/remove track, bus, plugin/device, routing
rewiring, send/return changes, structure-changing clip replacement) may take slower reconciliation
paths. Full taxonomy in `references/path-taxonomy.md`.

_Why: a parameter gesture is a hot, frequent event; routing a hot gesture through a graph rebuild
is the single most common engine performance bug._

### 5. Reconcile rather than recreate

Prefer targeted reconciliation over full teardown/rebuild: apply the changed parameter only,
update the changed routing edge only, add/remove affected nodes only, rebuild only the affected
subgraph when practical. The bad pattern is "something changed, rebuild the entire engine".

_Why: a blanket rebuild tears down live nodes mid-playback, dropping audio and discarding
runtime state that was expensive to construct._

### 6. Use `OfflineAudioContext` for export and analysis workflows

Offline rendering must use an explicit offline path: recreate the necessary graph
deterministically, apply project truth intentionally, run without UI timing assumptions, and
avoid piggybacking on live playback state. Do not use the live engine as your export engine.

_Why: the live engine carries transient runtime state and UI-driven timing; reusing it for export
makes renders non-deterministic and dependent on whatever the user happened to be doing._

## Fast path vs slow path (summary)

- **Fast path** — parameter changes, transport nudges, automation value application, meter
  snapshot reads, sample-accurate runtime control. Requirements: minimal overhead, no graph
  rebuild, no heavy object churn, no cross-layer leakage.
- **Slow path** — graph rebuilds, topology diffs, routing changes, device/plugin insertion or
  removal, transport reset-level changes, offline render preparation. Requirements: explicit
  orchestration, clear synchronization boundaries, no accidental triggering on hot user gestures
  unless intentionally coalesced.

Full breakdown (parameter-vs-topology examples, reconciliation granularity) in
`references/path-taxonomy.md`.

## Real-time safety rules

### Never do this on RT-adjacent paths

Do not: allocate unpredictably, acquire locks, perform DOM work, perform React state updates,
perform filesystem/network I/O, call Tauri commands, parse JSON, log excessively, or
create/destroy arbitrary runtime objects in hot loops.

_Why: every one of these can block or pause the audio render thread past its deadline, producing
an audible dropout — there is no recovery from a missed audio deadline._

### Worklet isolation rules

Worklets must be isolated from React, presentation code, domain stores, Tauri APIs, arbitrary
helper singletons, and non-worklet-safe shared utilities. Treat worklet code as RT-sensitive
code, not general app code.

_Why: worklet code runs on the render thread and has no access to the main-thread world safely;
importing app helpers smuggles allocation, blocking, or undefined globals into the hot path._

### Scheduling rules

The engine should schedule with a clear look-ahead model or equivalent deterministic transport
strategy. Do not make audio correctness depend on React render cadence, component mount order,
browser animation-frame timing, or view visibility.

_Why: rendering and visibility are best-effort and pausable; binding audio timing to them makes
playback stutter whenever the UI is busy or the tab is backgrounded._

## What does not belong

Belongs **outside** the engine: UI layout and editor state, selection, project-level ownership
rules, save/load workflows, command parsing, AI intent interpretation, non-runtime validation,
and view presentation formatting. The engine must not become the owner of persisted semantics or
decide project meaning — it executes truth projections. Latency-compensation *values* may be
derived from project/plugin/routing truth, but *applying* them to live playback is an engine
responsibility. The UI may display transport summaries and request changes, but must never own
playback phase, playhead progression, loop execution, or scheduling boundaries.

Full ownership catalogue (engine-owned vs project-truth, latency, transport) in
`references/ownership-map.md`.

## Refuses — temptation vs. do-instead

| Temptation (wrong) | Do instead (right) |
| --- | --- |
| Store `AudioContext`, `AudioNode`, engine instances, or worklet handles in React state, context, or general stores | Keep runtime objects engine-owned; expose only controlled APIs and summaries |
| Let a hook be the real owner of playback state | Hook sends commands and subscribes to engine summaries |
| Moving a fader rebuilds routing or recreates nodes | Keep the parameter path separate from the topology path (rule 4) |
| Mix/analyze/manipulate audio buffers in React hooks or render logic | Use worklets or engine-owned runtime code |
| Create a fresh `AudioContext` for preview, one-shots, quick meters | Route previews through the engine unless a distinct offline context is clearly justified |
| Engine decides project semantics or becomes persistence truth | Engine executes truth projections only |
| Export reuses live engine state and assumes current UI/runtime state is canonical | Offline render reconstructs the graph intentionally and deterministically |

## Self-review gate

Before declaring audio-engine work complete, walk this checklist and record the answer to each.
Any check whose answer is not a clear "yes" with a concrete reason is a blocker, not a pass.

1. Does the engine own time/routing/playback rather than the UI?
2. Is there exactly one live `AudioContext` (offline contexts only for render/export)?
3. Are all custom processors in `AudioWorklet` (no `ScriptProcessorNode`)?
4. Are parameter updates separated from topology updates (no rebuild on a parameter change)?
5. Does the engine consume truth rather than become truth?
6. Is reconciliation used rather than blanket rebuilds where practical?
7. Are RT-sensitive paths free of UI/framework/native-bridge leakage and unbounded allocation?
8. Is offline rendering explicit and deterministic?
9. Did the change reduce, not increase, runtime leakage into the rest of the app?

Then run and paste the project's static checks. **Not complete until the verbatim output of
`pnpm typecheck`, `pnpm lint`, and `pnpm deps:validate` appears in the write-up, each in its own
fenced block** — a "passes" claim without pasted output reads as Unverified, not Pass. If a
touched path has tests, paste `pnpm exec vitest run <path>` output too.

## Bundled resources

- `references/path-taxonomy.md` — full fast/slow path taxonomy: parameter-vs-topology examples
  and reconciliation granularity (rules 4–5).
- `references/ownership-map.md` — full ownership catalogue: engine-owned vs project-truth,
  what belongs where, latency, and transport guidance.
