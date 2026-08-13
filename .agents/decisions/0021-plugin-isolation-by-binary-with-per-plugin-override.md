---
type: adr
id: 0021
title: One helper per plugin binary, with a per-plugin full-isolation override
status: accepted
date: 2026-08-12
owner: The Sourdaw team
sources:
  - .agents/artifacts/sourdaw/SPEC-native-plugin-isolation.md
  - .agents/artifacts/sourdaw/CHANGE-plugin-hosting-runtime-and-transport.md
---

# 0021 — One helper per plugin binary, with a per-plugin full-isolation override

**Accepted 2026-08-12.** Resolved from primary sources under the owner's standing direction that decision gates are research tasks. Resolves `SPEC-native-plugin-isolation` DG-001, DG-002, DG-003 and
`CHANGE-plugin-hosting-runtime-and-transport` DG-002, DG-003.

## Context

Today there is no isolation of any kind. `crates/daw-plugin-host/src/scanner.rs:461` calls
`Library::new(path)`, `:464` resolves `clap_entry`, and `:479` invokes `init_fn` — third-party code
is `dlopen`ed and executed **in the Tauri application process during metadata scanning**, before the
user has instantiated anything. `clap_wrapper.rs:336` and `:389` repeat it at instantiation. There is
no child process, no supervisor, no `catch_unwind`, no timeout. `tauri.conf.json` declares no
`externalBin`, so no helper is bundled — which makes the comment in
`public/audio/worklets/native-plugin-bridge-processor.js:5`, "the plugin lives in another process",
false.

## Topology — one helper per plugin binary (DG-001)

Every host that documents isolation exposes it as a spectrum and lets the user choose. Bitwig ships
five levels: *Within*, *Together*, *By manufacturer*, *By plug-in*, *Individually* — with
**"Together" as the default**, and *Individually* described as "full isolation for each plug-in
process… This will require more computing resources, but that is the trade-off." REAPER offers
"Separate process" (one shared bridge, "if one plugin crashes the bridge process, all the other
bridged plugins will die too") and "Dedicated process" per plugin. FL Studio makes bridging a
per-plugin opt-in with in-process as the default. Apple's AUv3 is out-of-process by default but
publishes no instance-to-process cardinality.

**Nobody defaults to one process per instance.** It is a documented option everywhere and a default
nowhere.

**Decision:** one helper per `(format, canonical plugin id, resolved binary path, code-signature
identity)`, maximum 8 instances per helper, plus a per-plugin "run individually" override. This is
Bitwig's "By plug-in" as the working default with "Individually" as the escape hatch, and it buys the
property that matters, in Bitwig's own words: *"no plug-in's stability should be compromised by
another plug-in."*

Freeze the group size only after measuring helper RSS. Bitwig's "most memory-intensive" claim is
qualitative and no vendor publishes numbers. If measured private RSS is under ~3 MB per helper with
no added scheduling jitter, per-instance isolation becomes simpler than group multiplexing and should
win instead.

## Sandboxing — capability vocabulary, platform mechanism gated (DG-003)

Process isolation is standard among DAWs. **Kernel-enforced sandboxing of the plugin host is not** —
only the platform vendor enforces it, and REAPER offers the opposite (an option to "Terminate REAPER
immediately if a plug-in causes a corrupt heap").

Apple's model is the one to copy, because it is the only shipped one and it is capability-enumerated.
`AudioComponent.h` defines exactly four resource-usage keys — `iokit.user-client`,
`mach-lookup.global-name`, `network.client`, `temporary-exception.files.all.read-write` — and states
that a sandbox-safe component "can function correctly in even the most severely sandboxed process…
curtailed or no access to common system resources like the file system, device drivers, the network."
Crucially Apple also concedes that most plugins are *not* sandbox-safe, and provides a user-consent
escape: with the `com.apple.security.temporary-exception.audio-unit-host` entitlement, "the system
will ask the user whether or not it is acceptable… If the user says yes, the system will suspend the
process's sandbox."

**Decision:** adopt Apple's capability taxonomy as the cross-OS vocabulary; per-plugin unrestricted
relaxation requires explicit user confirmation recorded against the plugin's code-signature
identity. The concrete enforcement mechanism remains an implementation gate on each platform.

On macOS, do not build this architecture on `sandbox_init` or `sandbox-exec`; the `sandbox.h` API is
deprecated and no longer supported. Before implementation, prove that a separately signed App
Sandbox helper can load the supported third-party plugin set while receiving only brokered file and
resource grants. If it cannot, ship process isolation without claiming kernel sandboxing until a
supported mechanism exists. The application must still drop `disable-library-validation` and
`allow-unsigned-executable-memory`; today `Entitlements.plist:5-11` applies them app-wide and
`:31-33` disables App Sandbox entirely.

Windows and Linux require the same proof before their mechanisms are frozen: restricted token and
job-object/AppContainer feasibility on Windows; namespaces, Landlock and a seccomp floor on Linux.
Grant lifetime is one helper generation.

**Scan in a disposable helper of the same shape.** Both platform vendors eliminated the need to
execute code at discovery — Apple by Info.plist since 10.7, Steinberg by `moduleinfo.json` since
3.7.5 ("the host does not need to load the component to know which classes the module provides").
CLAP is the outlier: `entry.h` requires `init()` before any other symbol and offers only speed as
mitigation. That alone justifies the disposable scan helper. Tracked as #1612.

## Failure output — dry for effects, zero for instruments (DG-003 of the CHANGE plan)

No primary source states what a crashed slot outputs. Bitwig, REAPER and FL Studio all document the
containment and none document the audio. What **is** unanimous is the invariant: the rest of the mix
keeps playing, the failure is surfaced on the specific slot, and recovery is explicit — Bitwig's
"Reload Plug-in" / "Reload All Plug-ins", never automatic.

**Decision:** instruments and effects without valid dry input ramp to zero; effects with valid dry
input pass dry. 5 ms equal-power ramp at the first block boundary after detection, matching the
existing runtime bypass ramp so there is one ramp constant. Plugin-reported latency holds at its last
validated value and PDC is **not** renegotiated on failure. Offline render behaves identically so
export matches what was heard. Recovery is user-initiated only.

All-zero was rejected because it defeats the property the isolation project exists to buy: a crashed
EQ would mute the track, and "audio continues seamlessly" is meaningless then. The risk — a crashed
limiter or de-esser passing unprocessed material, possibly loud — is accepted explicitly, with the
visible per-slot failure state as the mitigation.

Independent of this decision: `src-tauri/src/commands/plugins.rs:956` currently returns the
**dry input** on ring underflow ("No output yet (first block)"), which contradicts the source
requirement that under-run outputs zero. That must change regardless of which failure policy is
chosen.

## Sources

- Bitwig plug-in hosting modes: https://www.bitwig.com/userguide/latest/vst_plug-in_handling_and_options/ · 2.5 release notes: https://downloads.bitwig.com/stable/2.5/Release-Notes-2.5.html · default: https://www.bitwig.com/learnings/plug-in-hosting-crash-protection-in-bitwig-studio-20/
- REAPER 7.78 user guide §16.18, §22.10.1: https://www.reaper.fm/userguide/ReaperUserGuide778.pdf
- FL Studio Wrapper: https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/wrapper.htm
- Apple `AudioToolbox/AudioComponent.h` (macOS SDK) — sandbox-safe keys, resourceUsage, AU discovery directories
- Steinberg `moduleinfo.json`: https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/VST+Module+Architecture/ModuleInfo-JSON.html
- CLAP `entry.h`: https://github.com/free-audio/clap/blob/main/include/clap/entry.h

**Unverified:** AUv3 instance-to-process cardinality; whether Live, Cubase or Studio One isolate the
scan specifically. Process-memory costs are qualitative in every vendor's documentation.
