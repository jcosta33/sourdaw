---

name: plugin-hosting
description: Apply when implementing or reviewing native plugin hosting, plugin scanning, plugin metadata, instance lifecycle, plugin editor windows, RT-safe host/plugin communication, or plugin-host failure handling. This is the authoritative skill for native plugin hosting.

---

# SKILL: plugin-hosting

## Purpose

Plugin hosting is a subsystem, not a convenience layer.

It combines:

- scanning and discovery
- metadata caching
- capability reporting
- instance lifecycle
- GUI/editor lifecycle
- RT-safe processing
- parameter/control flow
- host/plugin thread boundaries
- platform-specific native behavior
- failure isolation and recovery

This skill exists to keep plugin hosting isolated, safe, and aligned with the DAW architecture.

---

## Core architectural principles

### 1. Project-side plugin state is not runtime-side plugin state

Project truth may store:

- plugin identity
- slot/order placement
- configured parameter values
- preset references
- bypass state
- automation targets
- saved plugin-specific metadata that belongs to the project

Runtime/plugin-host state may store:

- live plugin instance
- native handle
- editor window
- processing buffers
- host-side communication channels
- scan/runtime caches
- crash isolation state

Do not conflate these.

### 2. Plugin hosting is a subsystem with separable concerns

Treat these as distinct concerns:

1. discovery
2. scan metadata
3. capability reporting
4. instantiation
5. parameter inspection
6. state save/restore
7. editor window management
8. audio processing
9. crash/failure isolation

If one abstraction owns too many of these, it is probably wrong.

### 3. Third-party plugin GUIs belong in native windows

Do not embed native plugin editors inside the webview UI.

Default model:

- DAW UI in the webview
- plugin editor in separate native window(s)

### 4. Hosting must remain RT-safe

GUI interaction, scanning, metadata reading, and editor management are not audio-thread work.

RT-sensitive plugin communication must use RT-safe paths.

### 5. Hosted plugins and built-in devices should converge conceptually where possible

Even if the runtime implementations differ, try to preserve a common conceptual surface for:

- parameters
- automation targets
- presets
- bypass
- routing participation
- instance identity

That improves consistency across the DAW.

---

## Lifecycle separation

### Discovery

Discovery finds candidate plugins.

It should not become live-host orchestration.

### Scan metadata

Scanning extracts:

- names
- formats
- capabilities
- parameter summaries
- I/O capabilities
- editor support indicators

This should be cacheable and failure-tolerant.

### Instantiation

Instantiation creates a live runtime instance.

This is separate from discovery and may fail independently.

### Parameter inspection

Parameter surfaces should remain host-visible whenever possible.
Do not make vendor GUIs the only control path.

### Editor management

Editor lifecycle is runtime/UI behavior, not project truth.

### Audio processing

Audio-thread-sensitive processing is distinct from all GUI/scan/control concerns.

---

## GUI/editor rules

### Plugin editors are runtime/UI bridges, not project truth

Opening, sizing, focusing, or closing an editor is runtime/UI behavior.

Do not let editor lifecycle leak into saved project truth unless explicitly designed.

### Editor code should not be the only control surface

Host-visible parameters must remain available for:

- automation
- generic inspector control
- preset/state persistence
- modulation
- accessibility/fallback workflows

---

## Threading and RT rules

### Never on RT-sensitive paths

Do not do these on audio-thread-sensitive plugin paths:

- allocate unpredictably
- lock
- open windows
- scan plugins
- perform filesystem work
- parse heavy metadata
- call UI code
- call shell event loops
- do blocking IPC

### Separate fast path from slow path

Fast path:

- parameter updates
- sample-accurate control
- RT-safe buffer processing

Slow path:

- scan/discovery
- instantiate/unload
- editor lifecycle
- metadata refresh
- failure recovery workflows

---

## Failure rules

Assume failure is normal.

Plan for:

- plugin load failure
- scan failure
- missing capabilities
- editor creation failure
- unsupported formats
- runtime crash/hang
- state restore failure
- platform-specific GUI issues

Failures must not silently corrupt project truth.

### Instantiation failure semantics must be explicit

If a plugin is added in project truth but runtime instantiation fails, define explicitly whether:

- the project mutation rolls back
- the slot remains with an error state
- the failure is recoverable via retry

Do not leave this ambiguous.

---

## Anti-patterns

### 1. Plugin instance stored in general app truth

Wrong:

- live plugin instance or native handle in app truth or shared UI state

Right:

- runtime/plugin-host owns live instances

### 2. Editor window treated as project semantics

Wrong:

- runtime editor UI state automatically saved as project truth

Right:

- editor lifecycle stays runtime/UI unless intentionally modeled

### 3. Scanning and hosting collapsed together

Wrong:

- one abstraction both scans files and acts as the live host

Right:

- separate metadata/discovery from live instance management

### 4. GUI path becomes the control path

Wrong:

- plugin is meaningfully controllable only through vendor GUI

Right:

- host-visible parameter surfaces remain explicit

### 5. RT path calls UI/window logic

Wrong:

- audio-thread-sensitive logic depends on editor or native-window operations

Right:

- isolate those concerns completely

### 6. Built-in and hosted plugins modeled in totally incompatible ways

Wrong:

- no shared conceptual surface for automation/parameters/presets

Right:

- align semantics where practical, even if runtimes differ

---

## Review checklist

Before accepting plugin-hosting code, verify:

1. Is project-side state separate from runtime instance state?
2. Are discovery, scanning, instantiation, editor lifecycle, and processing reasonably separated?
3. Are plugin GUIs handled as native runtime windows rather than webview embeds?
4. Are RT-sensitive paths lock-free and side-effect disciplined?
5. Are host-visible parameter surfaces preserved?
6. Are failures explicit and recoverable?
7. Did the change reduce or increase coupling between UI, truth, and runtime instances?

---
