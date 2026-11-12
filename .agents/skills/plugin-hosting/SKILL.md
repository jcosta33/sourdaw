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

Hosting spans discovery, metadata, lifecycle, GUI, RT processing, and failure recovery. Collapse them into one "plugin manager" and a single third-party crash or GUI quirk corrupts project truth or stalls the RT path.

## Core rules

### 1. Project-side plugin state is not runtime-side plugin state

- **Project truth may store:** plugin identity, slot/order, configured parameter values, preset references, bypass, automation targets, saved plugin-specific project metadata.
- **Runtime/plugin-host may store:** live instance, native handle, editor window, processing buffers, host communication channels, scan/runtime caches, failure and recovery state.

**Why:** project truth is serialized and long-lived; a live native handle is neither.

### 2. Treat hosting as separable concerns

Keep distinct: discovery, scan metadata, capability reporting, instantiation, parameter inspection, state save/restore, editor window management, audio processing, crash/failure isolation. An abstraction that owns several of them is wrong.

Scan metadata is cacheable and failure-isolated: one bad plugin must not abort the scan. Capability reporting reads that metadata without instantiating a live plugin.

**Why:** each concern fails, scales, and threads differently; one abstraction forces one wrong model onto all of them.

### 3. Scan roots are native-owned; discovery runs in the scan worker

The native layer owns scan roots: `get_default_plugin_paths` returns them, and `scan_plugins` accepts only those roots or their descendants. A renderer-supplied absolute path is not authority; a custom folder needs a native grant before it can be scanned. Scan paths are absolute only, and the scanner refuses symlinks, including a path with a symlinked ancestor. The walk uses the path the policy resolved, never the caller's spelling of it. Executing an untrusted plugin binary during discovery runs only in the bounded `plugin_scan_worker` child process, never in the app process.

**Why:** the renderer must not grant itself filesystem authority over IPC, a symlink under an allowed root would otherwise become an implicit grant outside it, and a check made against one path and a walk made against another is not a check. A third-party binary that crashes while being scanned takes down only the worker.

**Enforced by:** review only; policy in `docs/architecture/04-plugin-hosting-security.md` §1–2 and `crates/daw-plugin-host/AGENTS.md` (Scan Policy & Worker Isolation).

### 4. Third-party plugin GUIs belong in native windows

Never embed a native plugin editor inside the webview. DAW UI in the webview; plugin editor in separate native window(s).

**Why:** vendor editors expect a native window handle and event loop; embedding them couples a crash-prone surface to the app shell.

### 5. Hosting stays RT-safe; separate fast and slow paths

- **Fast (RT):** parameter updates, sample-accurate control, RT-safe buffer processing.
- **Slow (not RT):** scan/discovery, instantiate/unload, editor lifecycle, metadata refresh, failure recovery.

Never on an audio-thread-sensitive path: everything on the `web-audio-engine` RT-forbidden list (rule 7), plus plugin scanning, window/GUI work, and metadata parsing.

**Why:** the audio thread has a hard deadline; slow-path work on the fast path is how RT violations sneak in.

### 6. Hosted plugins and built-in devices converge conceptually

Runtimes may differ; the conceptual surface for parameters, automation targets, presets, bypass, routing participation, and instance identity stays common.

**Why:** automation, generic inspector, and preset code should not need two full code paths.

### 7. Editors are runtime/UI bridges — never the only control surface

Opening, sizing, focusing, and closing an editor is runtime/UI behavior, not project truth, unless explicitly modeled. Host-visible parameters stay available for automation, inspector, presets, modulation, and accessibility.

**Why:** if the vendor GUI is the only way to change a value, automation and a11y stop when the editor is closed.

### 8. Assume failure is normal; never silently corrupt project truth

Plan for load failure, scan failure, missing capabilities, editor creation failure, unsupported formats, runtime crash or hang, state restore failure, and platform-specific GUI issues.

When a plugin is added in project truth but runtime instantiation fails, define explicitly whether the mutation **rolls back**, the slot **remains in error state**, or **retry** is offered. Never leave that ambiguous.

Only scanning is process-isolated (rule 3). A hosted instance processes inline on the audio callback, once per block, in the chain that holds it (`native-audio-engine` rule 5), so a crash inside a plugin's process call is not contained by any child process. Never promise or design around crash isolation the runtime lacks. What does hold: failure state is runtime state, never project truth. A plugin that fails to load, instantiate, or restore degrades to a visible non-processing slot, and recovery runs on the slow path only.

**Why:** plugin hosting is the subsystem most exposed to third-party and platform failure; undefined instantiation semantics are how load failures corrupt saves, and a recovery design that assumes containment the process model does not provide fails exactly when it is needed.

## References

- [docs/architecture/04-plugin-hosting-security.md](../../../docs/architecture/04-plugin-hosting-security.md) — hosting security policy, scan roots, and IPC boundary.
- [crates/daw-plugin-host/AGENTS.md](../../../crates/daw-plugin-host/AGENTS.md) — scan policy, worker isolation, and audio-thread rules for the host crate.
- [.agents/decisions/0003-engine-owned-plugin-runtime-owner.md](../../decisions/0003-engine-owned-plugin-runtime-owner.md) — engine-owned plugin runtime.
- [.agents/decisions/0004-plugin-hosting-security-policy.md](../../decisions/0004-plugin-hosting-security-policy.md) — security policy decision.
