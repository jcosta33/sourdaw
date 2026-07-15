---
type: spec
id: SPEC-hardware-controller-ecosystem
title: Hardware controller ecosystem
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
  - ../../../src/modules/MIDI/workers/controllerScriptingWorker.ts
  - ../../../src/modules/Command/useCases/index.ts
  - ../../../src/modules/Command/useCases/executeAppAction.ts
  - ../../../src/modules/Command/useCases/commandQueries.ts
---

# Hardware controller ecosystem

## Intent

Build a controller profile and scripting ecosystem on top of the existing Web MIDI picker, MIDI
Learn, and MIDI preferences: auto-detecting controller profiles for popular hardware, a sandboxed
JavaScript/TypeScript scripting layer for third-party device scripts, and portable import/export
of custom mappings.

## Non-goals

- The base Web MIDI device selection, MIDI Learn, and preferences — already implemented.
- Server-side mapping distribution / marketplace — client-side only.

## Requirements

### AC-001 — Known controllers auto-load a profile

Connecting a recognized controller (Push, Launchpad, KeyStep, etc.) must auto-load its mapping
profile with visual mapping overlays, without manual MIDI Learn.

Verify with: `manual` — connect a known controller and confirm its profile loads and maps automatically

### AC-002 — Scripts run sandboxed and control parameters

The executable script-bundle pipeline separated by
[Push AC-028](../push-integration/spec.md#ac-028--separate-sandboxed-script-artifact) MUST run
third-party JS/TS only in a sandboxed Web Worker with no filesystem or network access. The worker
may register mappings, respond to MIDI/OSC, and request parameter or LED/display effects only by
emitting host-validated intents governed by AC-004 through AC-007; Worker isolation itself grants
no DAW or MIDI authority.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptSandbox.spec.ts`,
proving filesystem and network APIs are unavailable and scripts cannot call host DAW or MIDI APIs
directly.

### AC-003 — Mappings import and export as portable JSON

Custom device/macro mappings must import/export as a portable JSON format, client-side only.

Verify with: `pnpm test:run -- HardwareController mappingImportExport`

### AC-004 — Script grants are trusted and finite

For each connected script worker/session, a trusted host component MUST create and retain a
host-private `ControllerScriptGrant` carrying exactly the trusted script identity, a finite set of
exact `{ deviceId, paramId }` targets with no wildcard, and zero or one bound `midiOutputId`. The
grant is associated with the trusted connection/session out of band and is never serialized into
the script bundle or accepted from a worker message. A bundle or worker attempt to supply, replace,
or widen any grant field returns `SCRIPT_GRANT_UNTRUSTED` before an `AppAction` is created or MIDI
bytes are sent.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptHost.spec.ts`,
using host-issued grants and proving forged, self-issued, cross-session, and widened grants return
`SCRIPT_GRANT_UNTRUSTED` with zero Command dispatches and zero MIDI writes.

### AC-005 — Script effect intents have exact schemas

Every effect-bearing worker-to-host message MUST match this closed discriminated union after exact
host-side schema validation:

| Intent | Exact payload |
| --- | --- |
| `setDeviceParameter` | `{ deviceId: string, paramId: string, value: finite number }` |
| `sendMidi` | `{ bytes: integer[1..1024] }`, with every byte in `0..255`; no output identifier |

Unknown kinds, missing or additional fields, non-finite values, and invalid byte arrays return
`SCRIPT_MESSAGE_INVALID`; grant-bearing fields are rejected under AC-004. Validation completes
before owner lookup, `AppAction` creation, or MIDI output access.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptHost.spec.ts`,
covering unknown, missing, additional, grant-bearing, `NaN`, `Infinity`, empty, oversized,
non-integer, and out-of-range messages with zero Command dispatches, zero MIDI writes, and zero
store writes.

### AC-006 — Script parameter intents use Command

After AC-004 and AC-005 validation, a `setDeviceParameter` intent MUST match one exact granted
`{ deviceId, paramId }` target, resolve that target's owner, and dispatch only the typed
`setDeviceParameter` `AppAction` through Command's public `executeAppAction` export from
`#/modules/Command/useCases`. A missing grant returns `SCRIPT_TARGET_DENIED`; failed owner lookup
returns `SCRIPT_TARGET_UNRESOLVED`. The script host never calls the Command handler registry or a
registered handler directly, invokes an owning module's use case directly, or writes any store.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptHost.spec.ts`,
observing one exact public `executeAppAction` call for a granted target and no call for denied or
unresolved targets. Denied and unresolved cases produce zero Command dispatches, zero MIDI writes,
and zero store writes; direct handler and owner-use-case paths remain untouched. Also run
`pnpm deps:validate`.

### AC-007 — Script MIDI intents use one bound output

After AC-004 and AC-005 validation, a `sendMidi` intent MUST route only through the
`ControllerScriptGrant`'s bound `midiOutputId` and a MIDI-owned typed output port. The worker cannot
name or select an output. No bound output returns `SCRIPT_OUTPUT_UNBOUND`; a stale or foreign output
that is not owned by the trusted connection/session returns `SCRIPT_OUTPUT_DENIED`. Both outcomes
and any attempted output selection in a worker message send zero bytes.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptHost.spec.ts`,
covering a valid bound output, no binding, a stale/foreign output, and worker-supplied output fields;
denied cases produce zero Command dispatches, zero store writes, and never reach the MIDI-owned
port.

AC-002 and AC-004 through AC-007 are unimplemented today. The dormant current worker accepts raw
source through `new Function` and posts unvalidated `setParam`/`sendMidi` messages, but no current
launcher, trusted grant issuer, validating script host, Command dispatch, or MIDI-owned output
binding implements this future contract.

## Open questions

- [ ] (non-blocking) Minimum profile set for first release? Proposed: Push 2, Launchpad X, KeyStep.

## Affected areas

- new `HardwareController` module (profiles, scripting API, mapping management)
- builds on `MidiDevicePicker.tsx`, `midiLearnStore`, `MidiSection.tsx`

## Dropped from sources

- Mapping marketplace / distribution server — out of scope.
