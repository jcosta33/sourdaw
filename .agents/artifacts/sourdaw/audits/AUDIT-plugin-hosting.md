---
type: audit
id: AUDIT-plugin-hosting
title: Plugin hosting audit (native VST3/CLAP/AU + Faust web plugins)
status: complete
owner: audit/plugin-hosting lane
date: 2026-07-23
base_sha: 297198aa08fab728582b43c405e341d1d1066cff
scope: >
  Native plugin hosting (CLAP/VST3/AU via Tauri) and Faust web plugins:
  scanning, instantiation lifecycle, editor windows, host<->plugin RT
  communication, crash isolation, state persistence, latency reporting.
  AUDIT ONLY — no fixes.
---

# Plugin hosting audit

Observe. Prove. Prescribe nothing.

## Golden standard (research)

First-class plugin hosting, grounded in the CLAP spec, the VST3 SDK, and JUCE
hosting practice:

1. **Out-of-process scanning.** Every mature host scans plugins in a child
   process so a plugin that crashes, hangs, or pops a licensing dialog during
   scan cannot take down the host. Results and a persisted denylist ("dead
   man's pedal") survive across runs; a plugin that crashed the scanner is
   blacklisted and skipped next time. JUCE's `PluginDirectoryScanner` takes a
   `deadMansPedalFile`, and `KnownPluginList::applyBlacklistingsFromDeadMansPedal`
   reads it to blacklist crashers. [JUCE PluginDirectoryScanner], [JUCE KnownPluginList]

2. **Instantiation lifecycle honours thread-model contracts.** CLAP annotates
   each entry point with the thread it may run on: `init`/`activate`/`deactivate`
   are `[main-thread]`; `start_processing`/`stop_processing`/`process`/`reset`
   are `[audio-thread]`. "Once activated the latency and port configuration must
   remain constant, until deactivation." VST3 splits the plugin into an
   `IComponent` (processor) and an `IEditController` (UI/parameters) with a
   defined connect/synchronise handshake. [CLAP plugin.h], [VST3 SDK]

3. **Editor windows are native and pumped.** Vendor editors expect a native
   parent handle (NSView/HWND/X11) and a host-driven idle/timer tick; CLAP
   exposes `clap_host_timer_support` and `clap_host_gui.request_resize` for the
   plugin to drive repaint and resize negotiation. The host honours resize
   requests and pumps timers. [CLAP plugin.h]

4. **Host<->plugin RT communication is lock-free.** Parameter changes and events
   reach `process()` through queues/event-lists, never a lock or allocation on
   the audio thread; audio flows through shared-memory rings, not per-block IPC.

5. **Crash isolation with recovery UX.** Beyond scan, a hosted plugin that
   crashes at runtime degrades to a visible non-processing slot rather than
   killing the session; recovery (reload/retry) runs on the slow path.

6. **Chunk-based state persistence with version migration.** The host saves each
   plugin's opaque state chunk into the project and restores it on load, plus a
   missing-plugin placeholder that preserves the saved chunk when a referenced
   plugin is absent. CLAP state is an opaque `clap_ostream`/`clap_istream` blob.

7. **Truthful latency reporting to PDC.** The host queries plugin latency
   (`clap_plugin_latency.get()`, `[main-thread & (being-activated|active)]`) and
   feeds it to plugin-delay compensation. Latency may only change during
   `activate`; a running plugin must call `host->request_restart()` to change it,
   and the host must provide `clap_host_latency` for `changed()`. [CLAP latency.h]

The project's own draft spec `SPEC-plugin-hosting-clap` already codifies most of
this as acceptance criteria (AC-002 out-of-process sandbox; AC-003/AC-011/AC-012
SAB transport, no per-block IPC; AC-001 safe CLAP abstraction). That spec is
`status: draft` — none of it is implemented yet.

Citations:
- CLAP plugin thread model: https://github.com/free-audio/clap/blob/main/include/clap/plugin.h
- CLAP latency extension: https://github.com/free-audio/clap/blob/main/include/clap/ext/latency.h
- JUCE PluginDirectoryScanner (deadMansPedalFile): https://docs.juce.com/master/classPluginDirectoryScanner.html
- JUCE KnownPluginList (applyBlacklistingsFromDeadMansPedal): https://docs.juce.com/master/classKnownPluginList.html
- Steinberg VST3 SDK (component/controller split): https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Workflow+Diagrams/Audio+Processor+Call+Sequence.html

## Current-state map

Native hosting is a Rust crate (`crates/daw-plugin-host`) fronted by Tauri
commands (`src-tauri/src/commands/`), bridged into the TS audio engine.

- **Scanner** — `crates/daw-plugin-host/src/scanner.rs`. `scan_directory`
  (:68) walks dirs (symlink-guarded), `detect_format` (:50) keys off extension
  (`.vst3`/`.clap`/`.component`). `extract_clap_metadata` (:277) `dlopen`s each
  CLAP and calls its `init`/`deinit` **in the host process** to read vendor+id.
  `stable_id` (:40) = SHA-256 of the path.
- **CLAP wrapper** — `crates/daw-plugin-host/src/clap_wrapper.rs`. `new` (:161)
  loads, inits, queries `PARAMS`/`STATE`/`GUI` extensions (:279-281), activates,
  and calls `start_processing` (:300). RT process path `process_audio_internal`
  (:723) preallocates scratch; `process_with_midi_and_parameters` builds a
  lock-free event list. GUI lifecycle `open_gui`/`close_gui`. `Drop` (:1027)
  stop_processing/deactivate/destroy.
- **CLAP host callbacks** — `crates/daw-plugin-host/src/clap_host.rs`. Provides
  `PARAMS`/`GUI`/`STATE` host extensions only. `request_restart` (:62),
  `request_callback` (:71), `gui.request_resize` (:113) are logging/no-op TODOs.
- **VST3 wrapper** — `crates/daw-plugin-host/src/vst3_wrapper.rs`. Loads the
  binary and verifies `GetPluginFactory` exists; `process` (:105) is passthrough;
  params/state are empty stubs. "COM audio processing pending" (:4).
- **Runtime owner** — `src-tauri/src/host/native_bridge.rs`. `SharedClapPlugin`
  (:335) wraps the live wrapper in `UnsafeCell` with an `access_state` atomic:
  the RT `with_process` (:437) CAS-acquires or bails (dry passthrough for the
  block); the non-RT `with_control_locked` (:403) spin-waits (2 ms sleeps) up to
  a timeout. Lock-free `PendingParameterQueue` (:62) coalesces param writes.
  `ClapPluginSlot` (:481) is the `NativePlugin` processed inline by the engine.
- **Commands** — `src-tauri/src/commands/plugins.rs`: `scan_plugins` (:48),
  `load_plugin` (:108), `unload_plugin` (:263), `set_plugin_parameter` (:377),
  `get/set_plugin_state` (:445/:516), and `process_plugin_audio` (:608, per-block
  IPC relay). `src-tauri/src/commands/plugin_gui.rs`: `open_plugin_gui` (:60,
  bare native window via `WindowBuilder`, `resizable(false)`), close/hide/show.
  Scan authorization: `src-tauri/src/host/plugin_scan_policy.rs`.
- **Engine bridge (TS)** —
  `src/modules/AudioEngine/engine/NativePluginBridgeNode.ts` relays each audio
  block worklet -> MessagePort -> `processAudioIPC` (Tauri) -> Rust ring buffer
  -> back. Wired from `TrackNode.ts:484` for `external-plugin` devices.
  `NativeDspDeviceStrategy.ts` is built-in devices only (no plugin path).
- **Project truth** — `src/modules/Arrangement/models/Track.ts:148-149` stores a
  device `{ externalPluginId, externalInstanceId }`; `addExternalDevice.ts`
  commits the device then fire-and-forgets `loadPlugin`. `serializePluginLifecycle.ts`
  chains lifecycle ops per instance id.
- **Faust web plugins** — `src/modules/PluginHost/useCases/faustEngine/*`.
  `compileFaustDSP`/`compileAllFaustModules`/`registerFaustPluginLoader`; 17
  shipped `.dsp` sources under `faustEngine/dsp/`. Separate from native hosting.
- **Spec/decisions** — `.agents/specs/plugin-hosting-clap/spec.md` (draft),
  `.agents/decisions/0003-engine-owned-plugin-runtime-owner.md` (accepted),
  `0004-plugin-hosting-security-policy.md`.
- **Cross-ref** — `.agents/artifacts/sourdaw/audits/AUDIT-rt-engine-core.md`
  RT-4 (native plugin latency never reaches PDC).

## Findings

Severity: blocker / major / minor / polish. Effort: S / M / L.

### PH-1 — Plugin scanning runs in-process; a bad plugin kills the host — major, L

`extract_clap_metadata` (`scanner.rs:277-315`) `dlopen`s each CLAP and calls its
`init`/`get_factory`/`get_plugin_descriptor`/`deinit` directly in the host
process. It runs once inside `scan_directory` (`scanner.rs:133-135`) and **again**
for every CLAP while populating the registry (`plugins.rs:71-77`). A plugin that
segfaults, hangs, or blocks on a licensing dialog during `init` takes down the
whole DAW process. There is no denylist / dead-man's-pedal persistence: a
crasher is re-scanned (and re-crashes) every run.
- Failure mode: host death or hang mid-scan; unsaved project lost.
- Firing condition: any corrupt/incompatible/hostile CLAP on an authorized path.
- Blast radius: every scan; worse because metadata extraction is duplicated.
- Standard: golden #1; project's own AC-002 (out-of-process sandbox) is unmet.
- Negative claim verified: `grep -rni 'catch_unwind|sandbox|out.of.process|subprocess|denylist|blacklist'`
  over `src-tauri/src` and `crates/daw-plugin-host/src` returns no hosting hits.

### PH-2 — In-process runtime with no crash isolation; plugin runs inline on the audio thread — blocker, L

The live `ClapWrapper` is processed inline by the engine via `ClapPluginSlot`
(`native_bridge.rs:481+`, `with_process` -> `wrapper.process*`), i.e. the
third-party `plugin.process` C function executes **on the CPAL audio thread** in
the host address space. There is no `catch_unwind`, no watchdog, no
out-of-process boundary anywhere (same grep as PH-1). A plugin crash, hang, or
UB corrupts or kills the whole DAW and its running audio; there is no
degrade-to-non-processing-slot path. Decision 0003 explicitly lists
out-of-process sandboxing as a non-goal, and AC-002 is unimplemented, so this is
known/accepted debt — but it is the single largest blast radius in the subsystem.
- Failure mode: whole-app termination / audio-thread hang from third-party code.
- Firing condition: any misbehaving hosted plugin at runtime.
- Blast radius: entire session; the subsystem most exposed to third-party failure.
- Standard: golden #5; AC-002.

### PH-3 — Plugin state chunk is never persisted to the project — major, M

Status: FIXED in #730

`getPluginState`/`setPluginState` exist as repository functions
(`repositories/pluginBridge/getPluginState.ts`, `setPluginState.ts`) and Tauri
commands (`plugins.rs:445/:516`, faithfully serializing the CLAP chunk), but they
have **zero callers** and are **not exported** from
`PluginHost/useCases/index.ts` (verified: `grep -rn 'getPluginState\b' src`
returns only the definition; the index export grep is empty). Project truth
stores only `externalPluginId`, `externalInstanceId`, and `parameterValues`
(initialised `{}` in `addExternalDevice.ts:34`, never written back from the
plugin). No project save/load path calls `get/set_plugin_state`.
- Failure mode: reopening a saved project re-instantiates plugins at default
  state — every editor-driven tweak (preset, oversampling, internal routing)
  is silently lost.
- Firing condition: save + reload any project containing a native plugin.
- Blast radius: all persisted projects using native plugins.
- Standard: golden #6; plugin-hosting SKILL rule 1 ("project truth may store …
  saved plugin-specific project metadata") and rule 7 (never silently corrupt
  project truth).

### PH-4 — Native plugin latency is never queried or reported to PDC — major, M

The CLAP wrapper queries only `PARAMS`/`STATE`/`GUI` (`clap_wrapper.rs:279-281`);
`CLAP_EXT_LATENCY` is never queried (`grep` for LATENCY/latency/timer in the
crate returns nothing). The host descriptor provides no `clap_host_latency`
extension, and `host_request_restart` (`clap_host.rs:62`) is a no-op TODO — a
plugin that changes latency at runtime is ignored. `PluginInstance.latency_samples`
is hard-coded `0` on both load branches (`plugins.rs:222`, `:251`). This is the
hosting-side root of RT-4 (`AUDIT-rt-engine-core.md`): PDC treats every native
plugin as zero-latency.
- Failure mode: a lookahead plugin (linear-phase EQ, lookahead limiter) is not
  delay-compensated; its track drifts ahead of the mix by the plugin's latency.
- Firing condition: any latency-bearing native plugin in a multi-track project.
- Blast radius: every session mixing native plugins with other tracks.
- Standard: golden #7; CLAP latency.h; corroborates RT-4.

### PH-5 — Audio crosses per-block Tauri IPC, not shared memory — major, L

`NativePluginBridgeNode.ts:46-77` posts each block from the worklet to the main
thread, `await`s the async `process_plugin_audio` Tauri command
(`plugins.rs:608-664`), and posts the result back. It drops blocks under
backpressure (`pendingBlock`), and the Rust side allocates fresh `Vec`s per call
(`plugins.rs:632-663`). `src-tauri/AGENTS.md` documents this relay path. The
project's own AC-003/AC-011/AC-012 require SAB rings + a separate param queue and
"zero `tauriInvoke` calls inside `process()`"; none of that exists.
- Failure mode: added latency, jitter, and audible glitches (dropped blocks)
  proportional to IPC round-trip time; not RT-deterministic.
- Firing condition: any `external-plugin` device processing audio in the webview.
- Blast radius: every native plugin routed through the browser audio graph.
- Standard: golden #4; AC-003/AC-011/AC-012 (unmet).

### PH-6 — VST3 is silent passthrough; AU unsupported — major, M

`Vst3Wrapper::process` (`vst3_wrapper.rs:105-111`) copies input to output; params
and state are empty stubs; "COM audio processing pending" (`vst3_wrapper.rs:4`).
`Vst3PluginSlot::process_audio` (`native_bridge.rs`) is an explicit no-op. Yet
`load_plugin` returns `is_active: true` for VST3 (`plugins.rs:245-256`) with no
signal that it does nothing. AU load returns an error
(`plugins.rs` `"au" => Err(...)`).
- Failure mode: a VST3 added to a chain silently passes audio through unchanged;
  the user sees an "active" device that has no effect and whose knobs do nothing.
- Firing condition: loading any VST3 (the format most professional inventories
  are dominated by).
- Blast radius: all VST3 usage; format coverage is CLAP-only in practice.
- Standard: golden #2 (VST3 component/controller); SKILL rule 7 (visible failure).

### PH-7 — Load-failure semantics are undefined and unsurfaced — major, M

`addExternalDevice.ts:40-44` writes the device into project truth (`updateTrack`)
and then fire-and-forgets `void loadPlugin(...)`; the returned promise is never
awaited and its rejection is swallowed. `serializePluginLifecycle`/`loadPlugin`
(`useCases/pluginLifecycle/loadPlugin.ts`) surface no error slot. If native
instantiation fails (`ClapWrapper::new` error, activate returns false —
`plugins.rs:150-155`), the device remains in project truth with no error state,
no retry affordance, and no rollback. Decision 0003 mandates "keep a visible
non-processing error slot with retry metadata … Do not silently drop the slot."
- Failure mode: a device that exists in the project but never processes, with no
  UI indication of why; ambiguous rollback vs error-slot vs retry.
- Firing condition: any instantiation failure (missing plugin, activation fail,
  format mismatch, sample-rate mismatch).
- Blast radius: every failed native load; grows with library churn.
- Standard: golden #5; SKILL rule 7; Decision 0003 instantiation semantics.

### PH-8 — CLAP thread-model violated: start/stop_processing called off the audio thread — major, M

CLAP marks `start_processing`/`stop_processing` as `[audio-thread]`
([CLAP plugin.h]). `ClapWrapper::new` calls `start_processing` (`clap_wrapper.rs:300`)
on the Tauri command/loader thread, and `Drop` calls `stop_processing`
(`clap_wrapper.rs:1030`) on whichever thread drops the `Arc` (unload command or
retire-list cleanup). Neither is the audio thread. Many plugins tolerate this,
but it is a spec violation that `clap-validator` flags and that can corrupt
plugins which gate RT-state on these callbacks.
- Failure mode: undefined behaviour / state corruption in strict CLAP plugins.
- Firing condition: load/unload of any CLAP whose start/stop_processing is
  thread-affine.
- Blast radius: correctness of every engine-owned CLAP instance.
- Standard: golden #2; CLAP plugin.h thread annotations.

### PH-9 — Plugin output events are discarded; the vendor GUI becomes the only control path — major, M

`process()` passes `out_events: &EMPTY_OUTPUT_EVENTS` (`clap_wrapper.rs:801`), an
output list whose `try_push` accepts and drops everything
(`clap_wrapper.rs:115`). Parameter changes a user makes in the plugin's own
editor (emitted as output param-value events), and any plugin-generated MIDI
(arps, note effects), are silently discarded. Combined with PH-3, values set in
the vendor GUI never reach the inspector, automation recording, presets, or
project truth.
- Failure mode: turning a knob in the plugin editor does not update the host;
  no way to record automation from the GUI; plugin note output is lost.
- Firing condition: any interaction with a native plugin's own editor.
- Blast radius: all native-plugin editing and automation.
- Standard: golden #4; SKILL rule 6 (host-visible params must stay available;
  the vendor GUI must not be the only control path).

### PH-10 — Editor resize and idle pumping are unimplemented — minor, M

`host_gui_request_resize` (`clap_host.rs:113`) is a no-op TODO that returns true
without resizing, and the plugin window is created `resizable(false)`
(`plugin_gui.rs`, `open_plugin_gui` WindowBuilder). The host provides no
`clap_host_timer_support` extension (host_get_extension exposes only
PARAMS/GUI/STATE, `clap_host.rs:37-57`), and `request_callback`/`on_main_thread`
(`clap_host.rs:71`) is a no-op TODO. Editors that resize themselves or need a
host timer tick to repaint will not render/animate correctly.
- Failure mode: fixed-size, possibly non-repainting editor windows; plugin
  resize requests ignored.
- Firing condition: any plugin editor that drives resize or relies on host timers.
- Blast radius: editor UX across plugins.
- Standard: golden #3.

### PH-11 — Transport is never forwarded into the plugin process struct — minor, M

`clap_process.transport` is `ptr::null()` (`clap_wrapper.rs:795`), and
`process_with_events` ignores its `_transport` argument (`native_bridge.rs`).
Although `update_plugin_transport` (`plugins.rs`) plumbs a `TransportState` into
the engine, it is never converted to a `clap_event_transport` for the plugin.
Tempo-synced plugins (delays, LFOs, arps) receive no host tempo, time signature,
or playhead.
- Failure mode: tempo-sync plugins free-run instead of locking to the project.
- Firing condition: any host-sync-capable native plugin.
- Blast radius: correctness of tempo-synced native plugins.
- Standard: golden #4 (host<->plugin communication completeness).

### PH-12 — Scanned capability metadata is largely placeholder — minor, M

`scan_directory` hard-codes `num_inputs: 2`, `num_outputs: 2`,
`num_parameters: 0`, `version: ""`, `category: "effect"`, and
`has_custom_ui: true` for every plugin (`scanner.rs:146-158`), and VST3/AU get an
empty vendor and a filename-derived name (`scanner.rs:137-144`). Capability
reporting (SKILL rule 2/3, meant to read cached metadata without instantiating)
is therefore unreliable — a MIDI instrument is advertised as a 2-in/2-out effect,
UI presence is guessed.
- Failure mode: wrong port/category/parameter/UI info in the picker and routing.
- Firing condition: every scanned non-CLAP plugin (and CLAP port/param counts).
- Blast radius: plugin picker, routing decisions, inspector expectations.
- Standard: golden #1; SKILL rules 2–3.

### PH-13 — Plugin identity is path-derived, so moving/upgrading orphans references — minor, M

`stable_id` (`scanner.rs:40-48`) is SHA-256 of the plugin file path. The CLAP
descriptor id (a stable, path-independent identifier) is extracted
(`extract_clap_metadata`) but is not used for the persisted id. Moving a plugin
directory, or a vendor changing the install path across versions, changes the
`stable_id`, so a project's saved `externalPluginId` no longer resolves after a
scan.
- Failure mode: previously-working projects lose their plugin binding after a
  plugin relocation/upgrade, with no rebind.
- Firing condition: plugin path change between save and reload.
- Blast radius: project portability and longevity.
- Standard: golden #6 (state/version migration); cross-ref `plugin-identity` spec.

### PH-14 — `eprintln!` on plugin callback and lifecycle paths — polish, S

Numerous `eprintln!` calls sit on plugin lifecycle and host-callback paths
(`clap_host.rs` request_restart/gui callbacks; `clap_wrapper.rs` load/GUI/unload).
Host callbacks can be invoked from plugin threads; unbuffered stderr I/O there is
undesirable, and none of it is structured logging.
- Failure mode: noisy/unstructured logs; stderr I/O on callback paths.
- Blast radius: diagnostics quality; low.
- Standard: house logging conventions.

## Remediation roadmap

Severity-ordered; scoped, not prescriptive of an exact implementation.

1. **PH-2 / PH-1 (blocker/major, L)** — crash isolation. Out-of-process scan and
   host boundary per `SPEC-plugin-hosting-clap` AC-002; persist a denylist. This
   is a subsystem-scale effort already anticipated by Decision 0003's open
   questions.
2. **PH-3 (major, M)** — wire `get/set_plugin_state` into project save/load and
   store the chunk in project truth (SKILL rule 1); add a missing-plugin
   placeholder that preserves the chunk.
3. **PH-4 (major, M)** — query `CLAP_EXT_LATENCY`, provide `clap_host_latency`,
   implement `request_restart`, and thread the value into
   `externalLatencyRegistry` (RT-4 remediation shape).
4. **PH-7 (major, M)** — define instantiation failure semantics (error slot +
   retry metadata) per Decision 0003; stop swallowing `loadPlugin` rejection.
5. **PH-5 (major, L)** — replace per-block IPC with the SAB transport
   (AC-003/AC-011/AC-012).
6. **PH-6 (major, M)** — implement VST3 COM processing or mark VST3 slots
   visibly non-processing; keep AU as the documented non-goal.
7. **PH-9 / PH-8 / PH-11 (major/minor, M)** — consume plugin output events, run
   start/stop_processing on the audio thread, forward transport.
8. **PH-10 / PH-12 / PH-13 / PH-14 (minor/polish)** — editor resize+timer,
   real scan metadata, identity-based ids, structured logging.

## Open questions

- Is the engine-owned inline path (`ClapPluginSlot`) the sole runtime path, or
  does the `process_plugin_audio` IPC relay (PH-5) also carry audio for the same
  instances? `load_plugin` sets up both an engine slot and an `audio_bridge`;
  the exact division of labour under a running native engine was not proven by
  execution (static reading only).
- On macOS, `open_plugin_gui` runs `plugin.open_gui` (NSView `gui.create`/
  `set_parent`) from a Tauri async-command thread. Whether Tauri guarantees this
  is the main thread was not verified; NSView work off the main thread is a
  platform hazard worth a runtime check.
- Does any faust-web path share the native `PluginInstance` surface, or are they
  fully disjoint? (Appears disjoint; not exhaustively traced.)
- Not run dynamically: `cargo test -p daw-plugin-host`, plugin load against a
  real `.clap`, thread-affinity of start_processing. Timing/concurrency/crash
  claims above rest on static reading plus the cited specs; a live
  `clap-validator` pass would confirm PH-8/PH-9/PH-11.

## Evidence index

- `crates/daw-plugin-host/src/scanner.rs:40,50,68,133,146,277`
- `crates/daw-plugin-host/src/clap_wrapper.rs:115,161,279,300,795,801,1027,1030`
- `crates/daw-plugin-host/src/clap_host.rs:37,62,71,113`
- `crates/daw-plugin-host/src/vst3_wrapper.rs:4,105`
- `src-tauri/src/host/native_bridge.rs:335,403,437,481`
- `src-tauri/src/commands/plugins.rs:48,71,108,150,222,251,377,445,516,608`
- `src-tauri/src/commands/plugin_gui.rs:60`
- `src/modules/AudioEngine/engine/NativePluginBridgeNode.ts:46`
- `src/modules/AudioEngine/engine/TrackNode.ts:460,484`
- `src/modules/Arrangement/models/Track.ts:148`
- `src/modules/Arrangement/useCases/device/addExternalDevice.ts:34,40`
- `src/modules/PluginHost/repositories/pluginBridge/getPluginState.ts` (no callers)
- `.agents/specs/plugin-hosting-clap/spec.md` (draft; AC-001/002/003/011/012)
- `.agents/decisions/0003-engine-owned-plugin-runtime-owner.md`
- `.agents/artifacts/sourdaw/audits/AUDIT-rt-engine-core.md` (RT-4)
