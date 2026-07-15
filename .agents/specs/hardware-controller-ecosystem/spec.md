---
type: spec
id: SPEC-hardware-controller-ecosystem
title: Hardware controller ecosystem
status: draft
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
  - ../dependency-boundary-validation/spec.md
  - ../../decisions/README.md
  - ../../../src/modules/MIDI/workers/controllerScriptingWorker.ts
  - ../../../src/modules/Command/useCases/index.ts
  - ../../../src/modules/Command/useCases/executeAppAction.ts
  - ../../../src/modules/Command/useCases/commandQueries.ts
---

# Hardware controller ecosystem

## Intent

Build a controller profile and scripting ecosystem on top of the existing Web MIDI picker, MIDI
Learn, and MIDI preferences: auto-detecting controller profiles for popular hardware, a
capability-secure JavaScript/TypeScript scripting layer for third-party device scripts, and portable
import/export of custom mappings.

## Non-goals

- The base Web MIDI device selection, MIDI Learn, and preferences — already implemented.
- Server-side mapping distribution / marketplace — client-side only.

## Requirements

### AC-001 — Known controllers auto-load a profile

Connecting a recognized controller (Push, Launchpad, KeyStep, etc.) must auto-load its mapping
profile with visual mapping overlays, without manual MIDI Learn.

Verify with: `manual` — connect a known controller and confirm its profile loads and maps automatically

### AC-002 — Scripts require an accepted runtime ADR

Before any executable script-bundle implementation accepts source or launches a product session,
an ADR listed as accepted in `.agents/decisions/README.md` MUST select one concrete
capability-secure interpreter/compartment, or equivalently proven isolated runtime, and its exact
version. The ADR names package/artifact provenance and integrity checks, the Worker bootstrap and
lockdown order, runtime configuration and endowment construction, the pinned TypeScript compiler
and options, source/emitted-byte and execution time/memory limits, the denied-global and
constructor/prototype escape threat model, runtime-specific denial signaling, and the
version-upgrade revalidation rule. It also cites
a checked-in, reproducible proof against that exact runtime/version that the bootstrap exposes only
frozen allowlisted language intrinsics and the frozen `ControllerScriptApi`; AC-010 host requests
and that endowment are the script's only authority. A plain Web Worker, `new Function`, native
`eval`/module loading, dynamic `import()`, or CSP alone is not a runtime decision or confinement
proof. No such accepted ADR or runtime implementation exists today.

Verify with: the accepted ADR and ledger entry, its pinned dependency/integrity evidence, and the
exact runtime bootstrap proof command recorded by that ADR

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

### AC-008 — Current worker warning has one exact disposition

Under
[dependency-boundary-validation AC-007](../dependency-boundary-validation/spec.md#ac-007--durable-warning-ownership),
the `src/modules/MIDI/workers/controllerScriptingWorker.ts` warning MUST remain visible until either:

- that exact file becomes the distinct product script-bundle worker and satisfies AC-002 and
  AC-004 through AC-007 and AC-009 through AC-011 plus
  [Push AC-028](../push-integration/spec.md#ac-028--separate-capability-secure-script-artifact), including
  the accepted runtime ADR, closed source/protocol boundaries, and selected-runtime confinement
  evidence; or
- the same change satisfies the canonical accepted-ADR retirement condition in
  [dependency-boundary-validation AC-008](../dependency-boundary-validation/spec.md#ac-008--accepted-exact-path-retirement).

Worker presence, `new Function`, CSP alone, a launcher or synthetic import, a different replacement
worker, a registry entry, an orphan exception, or generic product reachability does not activate or
retire this warning. A replacement path is valid only through dependency AC-008's same-change
retirement condition.

Verify with: the linked dependency ownership row, the AC-002, AC-004 through AC-007, and AC-009
through AC-011 evidence, `rg -n "controllerScriptingWorker" src .agents/specs`, and
`pnpm deps:validate`.

### AC-009 — Script source loading is closed

The trusted host script-bundle loader MUST accept only the exact data object
`{ scriptId: string, apiVersion: supported literal, language: 'javascript' | 'typescript', source: UTF-8 text }`
with no unknown fields, source URL, blob URL, package/module graph, compiler options, plugin, or
loader hook supplied by the bundle. It rejects static imports/exports, `require`, `importScripts`,
dynamic `import()`, source-loading directives, malformed UTF-8, and unsupported API/language values
as `SCRIPT_SOURCE_INVALID`. JavaScript is parsed as one script. TypeScript is compiled without
executing it by the trusted host using the compiler version and fixed no-module, no-resolution,
no-plugin, no-source-map options selected in AC-002's ADR; any diagnostic returns
`SCRIPT_COMPILE_REJECTED` with no emit. The host computes `sourceDigest` as SHA-256 over the RFC 8785
canonical JSON encoding of the exact input, computes `scriptDigest` as SHA-256 over the emitted
JavaScript UTF-8 bytes, and retains `{ sourceDigest, scriptDigest, compiler identity/options }` in
the host-private session record. The Worker bootstrap accepts only that emitted JavaScript,
recomputes `scriptDigest`, and rejects a mismatch as `SCRIPT_SOURCE_INVALID`. Only the
digest-matched emitted JavaScript enters the ADR-selected runtime, never a native Worker evaluator.
Source or emitted JavaScript above the ADR's finite byte limit returns
`SCRIPT_SOURCE_TOO_LARGE` before runtime load.
Every rejection creates no runtime session, grant, intent, or effect.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptSource.spec.ts`,
covering exact JavaScript and TypeScript inputs, digest binding, malformed/unknown fields, URL and
module-loading forms, bundle-supplied compiler configuration, compile diagnostics, source/emitted
byte limits, and proof that rejected source never reaches the selected runtime

### AC-010 — Script results use one closed protocol

The trusted host and Worker bootstrap MUST communicate only through these exact, no-extra-field
envelopes:

| Direction | Envelope |
| --- | --- |
| Host to Worker load | `{ kind: 'load', requestId, sessionId, scriptId, scriptDigest, apiVersion, source }`, where `source` is only AC-009's emitted JavaScript |
| Worker to host load success | `{ kind: 'result', operation: 'load', requestId, sessionId, scriptId, scriptDigest, outcome: 'SCRIPT_READY' }` |
| Host to Worker execution | `{ kind: 'execute', requestId, sessionId, scriptId, scriptDigest, event }`, where `event` is one exact member of the closed `apiVersion`-owned `ControllerScriptEvent` union |
| Worker to host execution success | `{ kind: 'result', operation: 'execute', requestId, sessionId, scriptId, scriptDigest, outcome: 'SCRIPT_EXECUTION_OK', intents }`, where `intents` is an array of at most 256 AC-005 `ControllerScriptIntent` values |
| Worker to host failure | The correlated result fields for its operation, no `intents`, and one outcome from `SCRIPT_SOURCE_INVALID`, `SCRIPT_SANDBOX_UNAVAILABLE`, `SCRIPT_SANDBOX_VIOLATION`, `SCRIPT_EXECUTION_TIMEOUT`, `SCRIPT_EXECUTION_LIMIT`, or `SCRIPT_RUNTIME_ERROR` |

`requestId` and `sessionId` are host-generated non-empty opaque strings; `scriptId`,
`scriptDigest`, `apiVersion`, and `source` are the exact AC-009 values, with
`scriptDigest` encoded as 64 lowercase hexadecimal SHA-256 digits. An `apiVersion` is unsupported
until its complete `ControllerScriptEvent` union and exact per-member schemas are checked in.
AC-009's host-side `SCRIPT_SOURCE_INVALID`, `SCRIPT_SOURCE_TOO_LARGE`, and
`SCRIPT_COMPILE_REJECTED` outcomes occur before a Worker request; callers receive only those typed
outcomes or an AC-010 terminal result, never a raw compiler diagnostic, exception, or Worker object.

The selected runtime adapter maps its ADR-proven denied-global signal to
`SCRIPT_SANDBOX_VIOLATION` even when the real ambient value is absent, and never exposes a native
exception or runtime object. The trusted bootstrap is the only code allowed to call Worker
`postMessage`; it buffers script intents and emits exactly one terminal result per request. The
host exact-schema-validates and correlates the whole result before AC-004 through AC-007 are
permitted to process an intent. A load-phase intent, unknown/extra field, wrong correlation,
unrecognized outcome, over-limit intent list, duplicate terminal result, or script-originated
message returns `SCRIPT_PROTOCOL_INVALID`, terminates the session, and causes zero Command, MIDI,
or store effects. Every non-success outcome is fail closed with those same zero effects.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptProtocol.spec.ts`,
covering every request/result variant and typed outcome, absent denied globals, malformed and
mis-correlated envelopes, duplicate results, raw script messaging, intent overflow, and zero effects
for every failure

### AC-011 — Selected-runtime confinement is observed

The confinement integration harness MUST launch the production Worker bootstrap with the exact
runtime/version accepted under AC-002, not a fake Worker, deterministic shim, or API-name stub. The
ADR supplies a complete manifest of ambient capabilities for every supported Worker environment;
the harness fails if the live Worker global exposes an unclassified callable or authority-bearing
object. Before bootstrap, the harness instruments the Worker realm and canary endpoints to observe
constructor calls, network attempts, storage/filesystem access, navigation, child-worker creation,
and every Worker-to-host message. It then executes scripts that probe every manifest entry and, at
minimum, direct and `globalThis`/`self`/constructor/prototype paths to `postMessage`, `fetch`,
`WebSocket`, `XMLHttpRequest`, `EventSource`, `WebTransport`, `BroadcastChannel`, `importScripts`,
IndexedDB, Cache, storage/filesystem APIs, dynamic import, location/navigation, and Worker creation.
Forbidden source forms return the AC-009 source/compile outcome; runtime access and escape attempts
return `SCRIPT_SANDBOX_VIOLATION`. All probes observe zero outbound I/O, zero ambient side effects,
and no host message except the single AC-010 result. Bootstrap absence, integrity failure, lockdown
failure, manifest drift, or tampering returns `SCRIPT_SANDBOX_UNAVAILABLE`, terminates the session,
and never falls back to plain Worker execution. The same proof runs with Worker CSP relaxed or
absent; CSP remains defense in depth.

Verify with: the future owning integration test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptSandbox.spec.ts`,
using the ADR-selected production runtime/bootstrap and asserting the Worker-side observation log,
complete ambient-capability manifest, exact outcomes, and zero effects

AC-002 and AC-004 through AC-011 are unimplemented today. The dormant current worker accepts raw
source through `new Function` and posts unvalidated `setParam`/`sendMidi` messages, but no current
accepted runtime ADR, closed loader/protocol, confinement harness, launcher, trusted grant issuer,
validating script host, Command dispatch, or MIDI-owned output binding implements this future
contract.

## Open questions

- [ ] (non-blocking) Minimum profile set for first release? Proposed: Push 2, Launchpad X, KeyStep.

## Affected areas

- new `HardwareController` module (profiles, scripting API, mapping management)
- builds on `MidiDevicePicker.tsx`, `midiLearnStore`, `MidiSection.tsx`

## Dropped from sources

- Mapping marketplace / distribution server — out of scope.
