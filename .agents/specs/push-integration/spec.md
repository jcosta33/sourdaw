---
type: spec
id: SPEC-push-integration
title: Ableton Push 2 hardware integration
status: draft
owner: The Sourdaw team
sources:
    - ../hardware-controller-ecosystem/spec.md
    - ../dependency-boundary-validation/spec.md
    - ../../decisions/README.md
    - ../../../src/modules/Command/useCases/index.ts
    - ../../../src/modules/Command/useCases/executeAppAction.ts
    - ../../../src/modules/Command/useCases/commandQueries.ts
    - ../../../src/modules/MIDI/models/ControllerProfile.ts
    - ../../../src/modules/MIDI/useCases/hardware/importHardwareMappings.ts
    - ../../../src/modules/MIDI/useCases/hardware/exportHardwareMappings.ts
    - ../../../src/modules/MIDI/stores/hardwareControllerStore.ts
    - ../../../src/modules/MIDI/workers/controllerScriptingWorker.ts
---

# Ableton Push 2 hardware integration

## Intent

Drive an Ableton Push 2 over Web MIDI (pads, encoders, buttons, LEDs) and Web USB (the
960×160 RGB565 LCD framebuffer): hardware events dispatch DAW actions, and store changes
render back to the device, all behind a hardware driver module.

## Non-goals

- Push 3 support (different LCD/protocol) — detected and surfaced as not-yet-supported.
- A virtual on-screen Push for users without the hardware.
- Per-project persistence of Push state (it is a controller, stored in user settings).
- Off-thread framebuffer compositing (start on the main thread).

## Requirements

### AC-001 — MIDI message decoding

The codec must decode pad note-on/off, poly-aftertouch, relative encoder CCs (two's-complement
quirk), touch-strip pitch-bend, and function-button CCs into typed `PushEvent`s.

Verify with: `pnpm test:run -- PushHardware`

### AC-002 — Framebuffer encoding

Rendering four text lines must produce exactly a 20 480-byte framebuffer with the Push 2
XOR mask applied, matching a golden reference.

Verify with: `pnpm test:run -- PushHardware`

### AC-003 — Driver attach/detach lifecycle

`attachDriver` must open both transports, send the welcome sequence, and register store
subscriptions.

Verify with: `pnpm test:run -- PushHardware`

### AC-004 — Session-mode grid mapping

In session mode the 8×8 pad grid must map row=scene, column=track and sample each pad's
colour from the track/clip state.

Verify with: `pnpm test:run -- PushHardware`

### AC-005 — Pad-press routing by mode

A hardware pad press must dispatch the mode-correct action (session → `triggerScene`,
note → audition note, drum → `triggerToasterPad`).

Verify with: `pnpm test:run -- PushHardware`

### AC-006 — Echo suppression

A store change originating from a hardware event must not send a hardware update back for
the same surface within the cycle window.

Verify with: `pnpm test:run -- PushHardware`

### AC-007 — Hot-unplug recovery

A USB disconnect mid-transfer must dispatch `disconnectPush` and surface an error without
any throw escaping to the top level.

Verify with: `pnpm test:run -- PushHardware`

### AC-008 — Capability gating

On a runtime without Web USB, `createPushUsb` must return a `USB_UNSUPPORTED` error rather
than throwing.

Verify with: `pnpm test:run -- PushHardware`

### AC-009 — Settings persistence

`UserSettings.pushHardware` must round-trip (model, default mode/scale, encoder mappings)
across save and reload.

Verify with: `pnpm test:run -- PushHardware`

### AC-010 — Hardware module isolation

The `PushHardware` driver must reach other modules only through their public surfaces and
the existing `pushIntegration` use-cases.

Verify with: `pnpm deps:validate`

### AC-011 — End-to-end hardware pass

With a real Push 2: connect, switch modes, press a pad, turn an encoder, observe the LCD,
disconnect, and reconnect must all behave per the checklist.

Verify with: `manual` — run the documented Push hardware checklist with a real device

### AC-012 — Encoder and touch-strip behaviour

A relative-encoder delta must move the selected device's corresponding parameter (the 8 top
encoders map to the selected device's first 8 parameters).

Verify with: `pnpm test:run -- PushHardware`

### AC-013 — Chromatic, scale, and user pad modes

Beyond session/note/drum, the pad grid must support all six `PushPadMode` behaviours:
chromatic lays out every semitone left-to-right then bottom-to-top, scale shows scale-only
pads, and user mode passes raw MIDI through (no predefined pad mapping).

Verify with: `pnpm test:run -- PushHardware`

### AC-014 — Settings control surface and Command Palette entries

The Settings page must present a "Push 2 / Push 3" card (`ControlSurfacesTab`) with status,
connect/disconnect, mode, and scale/root-note controls.

Verify with: `pnpm test:run -- ControlSurfacesTab`

### AC-015 — Auto-connect on app start

When `UserSettings.pushHardware.enabled` is true, the driver must attempt to connect
automatically on app start, failing silently with a toast notification rather than throwing
when the device is not present.

Verify with: `pnpm test:run -- PushHardware`

### AC-016 — Push AppAction variants

`AppAction` must define and route the five new Push variants `disconnectPush`,
`setPushPadMode`, `setPushScale`, `mapPushEncoder`, and `setPushDisplayLine` (alongside the
existing `connectPush`).

Verify with: `pnpm test:run -- AppAction`

### AC-017 — Welcome feedback on connect

On a successful connect the device must show the welcome LCD text "Sourdaw connected" and
flash the welcome pad pattern, giving the user explicit connect-flow feedback.

Verify with: `pnpm test:run -- PushHardware`

### AC-018 — Driver detach lifecycle

`detachDriver` must close both transports and remove every subscription.

Verify with: `pnpm test:run -- PushHardware`

### AC-019 — Touch-strip pitch bend

A touch-strip position must drive pitch bend on the armed MIDI track.

Verify with: `pnpm test:run -- PushHardware`

### AC-020 — Command Palette Push entries

The Command Palette must expose the disconnect and Session/Note/Drum mode entries alongside
the existing connect entries.

Verify with: `pnpm test:run -- ControlSurfacesTab`

### AC-021 — Function-button AppAction routing

A pressed function button MUST dispatch its mapped `AppAction` via `routeButtonPress`; the v1
essential map covers Play, Stop, Record, metronome, undo, redo, Session, Note, Drum, Scale, and
arrow-key navigation, while unmapped buttons emit a generic `button-press` event.

Verify with: `pnpm test:run -- PushHardware`

### AC-022 — Transport state drives Play/Stop LEDs

A `transportStore` change must update the Push Play and Stop button LEDs so DAW transport state
is reflected on the hardware.

Verify with: `pnpm test:run -- PushHardware`

### AC-023 — Schema-validated declarative-profile messages

Every declarative controller-profile host boundary MUST accept only this one closed
`ControllerProfileHostRequest` union:

```text
MAX_CONTROLLER_PROTOCOL_ID_UTF8_BYTES = 256
ControllerProtocolId = non-empty string whose TextEncoder UTF-8 byte length is 1..256
FiniteNumber = number for which Number.isFinite(value) is true
ControllerProfileHostRequest =
  | {
      kind: "setDeviceParameter",
      payload: {
        deviceId: ControllerProtocolId,
        paramId: ControllerProtocolId,
        value: FiniteNumber
      }
    }
  | {
      kind: "sendMidi",
      payload: {
        bytes: Array of 1..1024 integer numbers, each in 0..255
      }
    }
```

The root and `payload` objects require ordinary-object prototypes and exactly the shown own string
keys; they have no symbols, aliases, omitted keys, inherited-only fields, or additional own keys.
The `bytes` value is an ordinary array with only its indexed elements and built-in `length`;
it is not a typed array. `profileId`, `allowedTargets`, `midiOutputId`, connection/session
identifiers, and every other binding or authority field are forbidden at both levels. Unknown
`kind`, wrong variant payload, malformed identifier, non-finite value, and every missing, extra,
symbol, or grant-bearing field maps deterministically to `INVALID_MESSAGE` before binding lookup,
owner lookup, `executeAppAction`, MIDI-port access, logging, or any other host effect. A valid
request is the only input accepted by AC-024 through AC-027. A request, profile-data object,
controller-input object, or worker message carrying `profileId`, `allowedTargets`, or
`midiOutputId` therefore returns `INVALID_MESSAGE` before any host-private binding handle or object
is looked up. No parameter descriptor, range, member set, integer rule, or step is part of the
`setDeviceParameter` payload; any caller-supplied descriptor field is likewise `INVALID_MESSAGE`
before binding or owner lookup.

Verify with: the future owning test, run as
`pnpm test:run src/modules/MIDI/useCases/hardware/__tests__/controllerProfileHost.spec.ts`, covering
both valid union variants, every malformed/unknown/extra-key case, symbols and grant-bearing
fields, the 256-byte identifier boundary, non-finite values, and byte arrays of lengths 0, 1,
1024, and 1025. Authority-field fixtures enter through request, profile data, controller input, and
worker-message channels. For each invalid fixture, assert `INVALID_MESSAGE` with zero
binding/owner lookups, Command calls, MIDI writes, and logs; also run `pnpm deps:validate`.

### AC-024 — Future controller-profile host binding

The future host contract MUST obtain each `ControllerProfileBinding` exclusively from a trusted
connection/session-owned host component, then validate declarative controller-profile data and
capability requests against that binding. Its target list uses the same
`MAX_CONTROLLER_TARGETS_PER_SESSION = 256` ceiling defined by
[hardware-controller-ecosystem AC-004](../hardware-controller-ecosystem/spec.md#ac-004--script-grants-are-trusted-and-finite),
and the binding has exactly these host-private fields:

| Field            | Contract                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profileId`      | One `ControllerProtocolId` issued for the bound profile.                                                                                                                    |
| `allowedTargets` | An array of 0..`MAX_CONTROLLER_TARGETS_PER_SESSION` unique `{ deviceId: ControllerProtocolId, paramId: ControllerProtocolId }` tuples; no wildcard or self-selected target. |
| `midiOutputId`   | One host-issued `ControllerProtocolId`, or `null` when this session has no bound output; never a caller-selected value.                                                     |

The binding is host-private, opaque runtime authority associated with the trusted connection or
session out of band. It is never deserialized from or exposed as profile data, controller input,
or a worker message; none of those untrusted channels can supply, replace, or expand its
`profileId`, `allowedTargets`, or `midiOutputId`. AC-023 schema validation runs before binding
lookup, so those fields on any untrusted payload/profile/controller/worker object return
`INVALID_MESSAGE`. `BINDING_UNTRUSTED` has one narrower meaning: the out-of-band host-private
binding handle or object is forged, replaced, or not the identical entry retained by the trusted
connection/session registry. The initial capability union is exactly the two AC-023 variants, and
the request supplies neither profile identity nor output identity: `profileId`, `allowedTargets`,
and `midiOutputId` always come from the registry-authenticated binding. Typed rejections are
`INVALID_MESSAGE`, `BINDING_UNTRUSTED`, `CAPABILITY_OR_TARGET_DENIED`, `TARGET_UNRESOLVED`,
`PARAMETER_VALUE_INVALID`, and `OUTPUT_UNBOUND`. This binding issuer, private authority registry,
schema validator, owner lookup, typed action mapping, and MIDI-owned typed output port are
unimplemented today; this is a future host contract.

Verify with: the future owning test, run as
`pnpm test:run src/modules/MIDI/useCases/hardware/__tests__/controllerProfileHost.spec.ts`, using
host-issued binding setup, exact-target matching, one-output binding, and all six typed rejection
outcomes. Binding fields supplied through request, profile JSON, controller input, or worker
messages return `INVALID_MESSAGE` with zero registry lookups. Forged, replaced, and non-registry
host-private handles or objects return `BINDING_UNTRUSTED` after schema validation but before
`AppAction` creation or MIDI send; inspect the current profile surface and run
`pnpm deps:validate`.

### AC-025 — Declarative profiles are source-free data

A Push profile or imported mapping profile MUST remain a source-free, schema-validated data
artifact through ingestion, loading, storage, host dispatch, and any declarative-profile worker
message. Each boundary rejects `source`, `code`, `scriptUrl`, script bundles, and equivalent
injected fields before storage or dispatch; declarative profile data is never evaluated, compiled,
or converted into executable code.

The complete current/future scan surface is
`src/modules/MIDI/models/ControllerProfile.ts`,
`src/modules/MIDI/useCases/hardware/importHardwareMappings.ts`,
`src/modules/MIDI/useCases/hardware/exportHardwareMappings.ts`,
`src/modules/MIDI/stores/hardwareControllerStore.ts`,
`src/modules/MIDI/workers/controllerScriptingWorker.ts`, and every future declarative-profile
ingestion, loader, store, host, or worker boundary under `src/modules/MIDI/` or
`src/modules/PushHardware/`. The current checkout does not implement this contract:
`ControllerProfile.scriptUrl` conflates profile data with executable-source location, and the
dormant worker accepts source and calls `new Function`. That worker leaves the declarative-profile
scan only after the distinct artifact/API split in AC-028 proves it cannot receive declarative
profiles, or after its exact path is retired under
[dependency-boundary-validation AC-008](../dependency-boundary-validation/spec.md#ac-008--accepted-exact-path-retirement).
Leaving the declarative-profile scan after a split does not activate or retire its `no-orphans`
warning; AC-028 defers that exact disposition to
[hardware-controller-ecosystem AC-008](../hardware-controller-ecosystem/spec.md#ac-008--current-worker-warning-has-one-exact-disposition)
and
[dependency-boundary-validation AC-007](../dependency-boundary-validation/spec.md#ac-007--durable-warning-ownership)
and the canonical dependency AC-008 condition linked above.

Verify with: the future owning test, run as
`pnpm test:run src/modules/MIDI/useCases/hardware/__tests__/controllerProfileBoundaries.spec.ts`, covering
injected source fields at ingestion, host, and worker boundaries; and
`rg -n 'ControllerProfile|scriptUrl|eval|new Function|Function\(' src/modules/MIDI src/modules/PushHardware`
after the surface exists, plus `pnpm deps:validate`.

### AC-026 — Exact setDeviceParameter grant

After AC-023 schema validation and AC-024 binding-authenticity validation, the host MUST consume
only the `kind: "setDeviceParameter"` member, require its exact
`payload.{ deviceId, paramId }` tuple in the trusted binding's `allowedTargets`, perform one
successful owner lookup for that tuple, retrieve the current owner-authoritative
`OwnerParameterValueDescriptor`, and apply the value-validity predicate defined by
[hardware-controller-ecosystem AC-006](../hardware-controller-ecosystem/spec.md#ac-006--script-parameter-intents-use-command).
Only then does it dispatch the typed `setDeviceParameter` `AppAction` through Command's public
`executeAppAction` export from `#/modules/Command/useCases`. The request's `deviceId`, `paramId`,
and `value` are operation data; binding identity comes only from the trusted binding, and neither
the request nor binding can supply or override the owner descriptor. The host never calls Command's
handler registry or a registered handler directly, invokes Arrangement's owning
`setDeviceParameter` use case directly, or writes any store. A missing grant returns
`CAPABILITY_OR_TARGET_DENIED`; an unsuccessful owner lookup or missing, malformed, or
owner-reported-stale descriptor returns `TARGET_UNRESOLVED`; a value that fails the current valid
descriptor returns `PARAMETER_VALUE_INVALID`; an untrusted host-private binding returns
`BINDING_UNTRUSTED`. None dispatches an action or reaches engine, MIDI, or store effects.

Verify with: the future owning test, run as
`pnpm test:run src/modules/MIDI/useCases/hardware/__tests__/controllerProfileHost.spec.ts`, using
the `setDeviceParameter` variant for granted continuous minimum/maximum, integer/step, and exact
discrete-member values; `Number.MAX_VALUE`, `-Number.MAX_VALUE`, out-of-range, non-integer,
non-step, and non-member values; missing and stale descriptors; denied and unknown targets;
non-finite and extra-field messages; wrong variants; and forged host-private bindings. Descriptor
fields in the request return `INVALID_MESSAGE` before binding lookup. Descriptor-validity failures
are `TARGET_UNRESOLVED`; value-predicate failures return `PARAMETER_VALUE_INVALID` after one owner
lookup and with zero `executeAppAction`, engine, MIDI, or store calls. Missing or stale descriptors
also return `TARGET_UNRESOLVED` with the same zero effects. The handler registry and owner use case
are never invoked directly. Also run `pnpm deps:validate`.

### AC-027 — Bound sendMidi output

After AC-023 schema validation and AC-024 binding-authenticity validation, the host MUST consume
only the `kind: "sendMidi"` member, take its exact `payload.bytes` array, and route it only through
the MIDI-owned typed output port selected by the trusted binding's `midiOutputId`. Before typed-port
access, the host takes the binding-owner connection/session key from AC-024's out-of-band private
registry association, and the MIDI-owned output registry resolves a non-null id to its current
`{ port, ownerKey, connectionState }` entry. It returns the port only when `connectionState` is
`"connected"` and `ownerKey` equals the binding-owner key. A `null` id, absent/stale entry,
disconnected entry, same-id entry rebound to another owner, or foreign-owner entry returns
`OUTPUT_UNBOUND`; that one outcome covers every unavailable or no-longer-owned binding. The request
has no output-identity field.
Invalid bytes return `INVALID_MESSAGE` before binding/output lookup; `midiOutputId` or either other
AC-024 authority field on a request/profile/controller/worker object also returns `INVALID_MESSAGE`
before binding lookup. Only a forged, replaced, or non-registry host-private binding handle or object
returns `BINDING_UNTRUSTED`. Every rejection occurs before typed-port access and causes zero MIDI,
Command, store, or logging effects.

Verify with: the future owning test, run as
`pnpm test:run src/modules/MIDI/useCases/hardware/__tests__/controllerProfileHost.spec.ts`, covering
the exact `sendMidi` variant with lengths 1 and 1024, empty/oversized/non-integer/out-of-range
bytes, extra keys, a wrong variant, and attempts to supply or replace `midiOutputId` through each
untrusted channel. Registry fixtures cover a same-owner connected port, `null`, stale/absent,
disconnected, same-id rebound, and foreign-owner entries. Each unavailable/ownership fixture expects
`OUTPUT_UNBOUND` and zero typed-port access, MIDI writes, Command calls, store writes, or logs; the
null fixture makes zero output-registry lookups, and each other fixture makes exactly one. Each
authority-field fixture expects `INVALID_MESSAGE` and zero binding lookups;
forged/replaced/non-registry host-private binding fixtures expect `BINDING_UNTRUSTED`. The valid case
performs one output-registry lookup and sends the same validated bytes exactly once; also run
`pnpm deps:validate`.

### AC-028 — Separate capability-secure script artifact

A future executable controller-script artifact/API, provisionally `ControllerScriptBundle`, MUST
use a distinct hardware-controller-ecosystem-owned ingestion, storage, and worker pipeline and
never enter the declarative profile ingestion, storage, binding, host-message, or worker-message
path governed by AC-023 through AC-027. That separate pipeline is the sole route for JS/TS to the
HardwareController-owned ADR-selected restricted runtime required by
[hardware-controller-ecosystem AC-002](../hardware-controller-ecosystem/spec.md#ac-002--scripts-require-an-accepted-runtime-adr),
[closed source loader](../hardware-controller-ecosystem/spec.md#ac-009--script-source-loading-is-closed),
[closed protocol](../hardware-controller-ecosystem/spec.md#ac-010--script-results-use-one-closed-protocol),
and [selected-runtime harness](../hardware-controller-ecosystem/spec.md#ac-011--selected-runtime-confinement-is-observed),
and remains subject to the ecosystem-owned
[trusted-grant](../hardware-controller-ecosystem/spec.md#ac-004--script-grants-are-trusted-and-finite),
[intent-schema](../hardware-controller-ecosystem/spec.md#ac-005--script-effect-intents-have-exact-schemas),
[Command-dispatch](../hardware-controller-ecosystem/spec.md#ac-006--script-parameter-intents-use-command),
and [bound-output](../hardware-controller-ecosystem/spec.md#ac-007--script-midi-intents-use-one-bound-output)
contracts.

A plain Web Worker, `new Function`, a launcher, or CSP-only confinement cannot satisfy this
executable path. The exact current-worker activation or canonical accepted-ADR retirement remains
owned by
[hardware-controller-ecosystem AC-008](../hardware-controller-ecosystem/spec.md#ac-008--current-worker-warning-has-one-exact-disposition)
and
[dependency-boundary-validation AC-007](../dependency-boundary-validation/spec.md#ac-007--durable-warning-ownership)
and [AC-008](../dependency-boundary-validation/spec.md#ac-008--accepted-exact-path-retirement).

Those hardware-controller-ecosystem requirements remain authoritative for executable-script
runtime confinement, source loading, protocol, grants, intent validation, and effects; Push AC-023
through AC-027 remain authoritative for declarative profiles and their host capabilities. A split
or replacement of common `ControllerProfile` types is valid only when an accepted ADR listed in
`.agents/decisions/README.md` names both specifications, assigns distinct public data-profile and
script-bundle types/APIs, updates both cross-links and owning tests in the same change, and
preserves both requirement sets. If that split retires a warning path, the same change also
satisfies dependency AC-008. Otherwise neither specification supersedes the other. This contract
is unimplemented today: the current `scriptUrl` field and dormant `new Function` worker conflate
the artifacts and satisfy neither contract.

Verify with: the future declarative-profile boundary test
`pnpm test:run src/modules/MIDI/useCases/hardware/__tests__/controllerProfileBoundaries.spec.ts`,
proving a script bundle is rejected by every declarative boundary; the future ecosystem runtime,
source, protocol, confinement, and host tests under
`src/modules/HardwareController/useCases/__tests__/`; and
`pnpm deps:validate`.

## Open questions

- [ ] Q-001 — Default encoder target: selected-device parameters or selected-track volumes?
- [ ] Q-002 — Tauri-desktop transport bindings (native USB/MIDI plugins) vs browser APIs —
      which is the primary target for v1?
- [ ] Q-003 — Which function buttons get explicit maps in v1 vs a generic `button-press`?
- [ ] Q-004 — Auto-mapped controller-profile scripting API (deferred-gap from
      intake/implementation-gaps.md §5.5 "Deep MPE Editing & Hardware Scripting").
      Non-blocking. The Push 2 driver in this spec is one hardcoded profile; the larger gap is
      to expand the scripting API so hardware controller profiles auto-map for multiple devices
      (named examples: Push, Launchpad), with community sharing of those profiles. Decide whether
      the `PushHardware` driver should be authored against a generic controller-profile/scripting
      abstraction now (so Launchpad and others can be added without a bespoke module each) or
      shipped as a standalone Push module first and generalised later. Note: the per-note
      expression-lane (timbre/pressure/pitch in the Piano Roll) half of §5.5 is MPE-editor scope,
      not part of this Push-integration spec.
      Q-004 is sequencing/generalization context only. It does not own, close, defer, weaken, or
      replace AC-023 through AC-028. Declarative profiles remain data-only under AC-025; executable
      script bundles use only the separate ecosystem-owned restricted-runtime path in AC-028 and
      hardware-controller-ecosystem AC-002, AC-004 through AC-011. The dependency-boundary map
      points to those requirements for the current worker warning.
- [ ] Q-005 — DAW-level controller-learning (MIDI-learn) registry (deferred-gap from
      intake/implementation-gaps.md §7.8d "Controller Learning, Routing Visualization").
      Non-blocking for the Push driver, but it overlaps this spec's encoder/pad mapping. The gap
      is a global MIDI-learn registry that maps any hardware MIDI CC (and MPE per-note) to any
      automatable parameter surfaced by the parameter registry — UI: right-click "MIDI Learn" on
      any control, then move a hardware controller; the mapping is persisted both per-project and
      per-user template. Stated acceptance targets to honour if this registry lands: learning
      CC 74 to a filter cutoff makes the cutoff track the hardware knob within ≤ 1 audio block at
      48 kHz / 128-sample buffer; clearing a learned mapping removes it from both the project save
      and the user template (verified by JSON diff). Decide whether Push encoder mappings
      (AC-009, AC-012) should flow through this shared registry or stay in the Push settings
      block. Note: the routing-visualization half of §7.8d (force-directed track→bus→device node
      graph, read-only in v1) is unrelated to Push integration and out of scope here.
- [ ] Q-006 — Push 2 byte-level protocol reference (restored detail). The concrete wire-format
      constants behind AC-001/AC-002/AC-004 are not yet pinned in this spec; capture them before the
      codec/framebuffer tasks are cut: pad RGB SysEx `F0 47 7F 15 04 00 08 <pad index 0–63> <R> <G>
<B> F7` (7-bit colour components); pad notes (channel 1) note-on/off in range 36–99; top
      encoders relative CC 71–78; tempo encoder relative CC 14; function buttons CC 3–87 (on/off LED
      state); touch strip as pitch bend; USB filter `vendorId 0x2982 / productId 0x1967`; MIDI on
      endpoints 0x02/0x82, LCD framebuffer on bulk endpoint 0x01; framebuffer = 20 lines × 160 px ×
      16-bit RGB565 (20 480 bytes) XORed with the Push 2 fixed mask. Decide whether these belong in a
      `Push2Protocol` model constant set or an appendix, but they must not be lost.
- [ ] Q-007 — Function signature shape for the Push use-cases (restored detail). The existing
      `pushIntegration` use-cases take positional args against the AGENTS.md single-object-param
      rule: `setEncoderValue(encoderIndex, value)`, `handlePadPress(padIndex, velocity)`,
      `setPadColor(padIndex, color)`. Decide whether the new `PushHardware` driver use-cases adopt
      the single-object-param convention from the start (and whether the existing three are
      realigned) so the driver layer is consistent.
- [ ] Q-008 — Unload-failure recovery for hardware/plugin teardown (restored detail). Device
      removal fire-and-forgets unload (`Arrangement/useCases/device/removeDevice.ts:18`
      `void unloadPlugin(externalInstanceId)`): if the unload rejects, the JS-side device is gone but
      the Rust host still tracks the instance — a permanent leak with no retry, notification, or
      force-unload path. AC-018 (`detachDriver` closes both transports) shares this exposure on the
      Push side. Decide whether driver detach (and the device-removal path it depends on) must
      surface and retry/force a failed unload rather than swallow it.

## Known risks

- Preset import validation is too weak to protect the engine, on the same
  `pushIntegration`-adjacent `Plugin` surface this spec consumes.
  `src/modules/Plugin/repositories/proofChamberPresets/importPresetJson.ts:6` gates only
  on `typeof parsed.mix === 'number' && typeof parsed.decay === 'number'`, then spreads
  the parsed object into `DEFAULT_PARAMS`. That `typeof === 'number'` test accepts `NaN`,
  `Infinity`, `-Infinity`, and unbounded out-of-range values (`mix: 1e6`, `decay: -0.5`)
  with no clamping; spread values reach the Rust engine, which multiplies by them and can
  emit `NaN` audio. The same import also accepts unknown enums (`algorithm: 'fdn-32'`, not
  in the union): the cast is trusted, `ALGORITHM_MAP['fdn-32']` (`ProofChamberState.ts:53`)
  returns `undefined`, and the `setDeviceParameter` AppAction sends `value: undefined` to
  the host — IPC then drops or nulls the field (undefined behaviour either way). The Push
  encoder/parameter routing (AC-012, AC-016 `mapPushEncoder`) drives the same parameter
  surface, so any range/enum-membership validation added for hardware-sourced parameter
  writes should cover the preset-import path too rather than re-validating per entry point.

## Affected areas

- `src/modules/PushHardware/` (new driver module: repositories, services, use-cases)
- `src/modules/Plugin/useCases/pushIntegration/` + `stores/push.ts` (local-state layer, consumed)
- `src/modules/Command/` (new Push AppAction variants + routing)
- `src/modules/Arrangement/`, `Transport/`, `Toaster/`, `MIDI/` (subscription/dispatch targets)
- user settings persistence (`pushHardware` block)

## Dropped from sources

- Push 3 support — separate spec; v1 surfaces it as not-yet-supported.
- Virtual on-screen Push view — explicit v2 / out-of-scope.
- Off-thread framebuffer worker — start on-thread; revisit only if perf demands.
- The session-by-session milestone breakdown (M1–M5) — delivery planning, not spec content.
