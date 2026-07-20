---
name: plugin-hosting
description: >-
  Isolate native plugin hosting as a subsystem with separable concerns: scanning,
  instantiation, editor windows, RT-safe processing, and failure recovery. ALWAYS
  apply when implementing or reviewing plugin scanning, metadata, instance
  lifecycle, editor windows, host/plugin communication, or plugin-host failure
  handling. Skip built-in DSP device authoring, general audio-engine/transport
  work, and non-plugin window management.
---

## Purpose

Plugin hosting spans discovery, metadata, lifecycle, GUI, RT processing, and failure recovery. Collapsing those into one “plugin manager” means one third-party crash or GUI quirk can corrupt project truth or stall the RT path. Keep hosting isolated, RT-safe, and aligned with the project/runtime split.

## Core rules

### 1. Project-side plugin state is not runtime-side plugin state

| Project truth may store | Runtime/plugin-host may store |
|---|---|
| plugin identity, slot/order, configured parameter values, preset references, bypass, automation targets, saved plugin-specific project metadata | live instance, native handle, editor window, processing buffers, host communication channels, scan/runtime caches, crash-isolation state |

Do not conflate them.

**Why:** project truth is serialized and long-lived; a live native handle is neither.

### 2. Treat hosting as separable concerns

Keep distinct: (1) discovery, (2) scan metadata, (3) capability reporting, (4) instantiation, (5) parameter inspection, (6) state save/restore, (7) editor window management, (8) audio processing, (9) crash/failure isolation. If one abstraction owns too many, it is wrong.

Scan metadata is cacheable and failure-isolated: one bad plugin must not abort the scan. Capability reporting reads that metadata without instantiating a live plugin.

**Why:** each concern fails, scales, and threads differently; one abstraction forces one wrong model onto all of them.

### 3. Third-party plugin GUIs belong in native windows

Do not embed native plugin editors inside the webview. Default: DAW UI in the webview; plugin editor in separate native window(s).

**Why:** vendor editors expect a native window handle and event loop; embedding them couples a crash-prone surface to the app shell.

### 4. Hosting must remain RT-safe; separate fast and slow paths

**Fast (RT):** parameter updates, sample-accurate control, RT-safe buffer processing.

**Slow (not RT):** scan/discovery, instantiate/unload, editor lifecycle, metadata refresh, failure recovery.

Never on audio-thread-sensitive paths: anything on the `web-audio-engine` RT-forbidden list (rule 7), plus plugin scanning, window/GUI work, and metadata parsing.

**Why:** the audio thread has a hard deadline; slow-path work on the fast path is how RT violations sneak in.

### 5. Hosted plugins and built-in devices converge conceptually

Even if runtimes differ, preserve a common conceptual surface for parameters, automation targets, presets, bypass, routing participation, and instance identity.

**Why:** automation, generic inspector, and preset code should not need two full code paths.

### 6. Editors are runtime/UI bridges — never the only control surface

Opening, sizing, focusing, or closing an editor is runtime/UI behavior, not project truth (unless explicitly modeled). Host-visible parameters must remain available for automation, inspector, presets, modulation, and accessibility. Do not make the vendor GUI the only control path.

**Why:** if the vendor GUI is the only way to change a value, automation and a11y stop when the editor is closed.

### 7. Assume failure is normal; never silently corrupt project truth

Plan for: load failure, scan failure, missing capabilities, editor creation failure, unsupported formats, runtime crash/hang, state restore failure, platform-specific GUI issues.

If a plugin is added in project truth but runtime instantiation fails, define explicitly whether the mutation **rolls back**, the slot **remains in error state**, or **retry** is offered. Do not leave that ambiguous.

Isolation: crash/hang isolation is runtime state, never project truth; a failed plugin degrades to a visible non-processing slot; recovery runs on the slow path only.

**Why:** plugin hosting is the subsystem most exposed to third-party and platform failure; undefined instantiation semantics are how load failures corrupt saves.

## References

- [docs/architecture/04-plugin-hosting-security.md](../../../docs/architecture/04-plugin-hosting-security.md) — hosting security policy.
- [.agents/decisions/0003-engine-owned-plugin-runtime-owner.md](../../decisions/0003-engine-owned-plugin-runtime-owner.md) — engine-owned plugin runtime.
- [.agents/decisions/0004-plugin-hosting-security-policy.md](../../decisions/0004-plugin-hosting-security-policy.md) — security policy decision.
