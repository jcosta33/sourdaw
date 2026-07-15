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
host-side schema validation. `MAX_WORKER_PROTOCOL_ID_UTF8_BYTES = 256` and
`MAX_WORKER_DIAGNOSTIC_UTF8_BYTES = 4096` are reusable Worker-message limits measured as
`new TextEncoder().encode(value).byteLength`; `WorkerProtocolId` is a non-empty string within the
identifier limit, and `WorkerDiagnostic` is a non-empty string within the diagnostic limit:

| Intent               | Exact payload                                                                     |
| -------------------- | --------------------------------------------------------------------------------- |
| `setDeviceParameter` | `{ deviceId: WorkerProtocolId, paramId: WorkerProtocolId, value: finite number }` |
| `sendMidi`           | `{ bytes: integer[1..1024] }`, with every byte in `0..255`; no output identifier  |

Unknown kinds, missing or additional fields, non-finite values, and invalid byte arrays return
`SCRIPT_MESSAGE_INVALID`; over-limit `deviceId` or `paramId` returns the same code, and grant-bearing
fields are rejected under AC-004. The trusted bootstrap rejects an over-limit intent identifier
while buffering intents and posts one AC-010 `SCRIPT_EXECUTION_LIMIT` result with no `intents`.
The host independently validates a received intent after structured clone and before correlation,
payload logging, owner lookup, `AppAction` creation, or MIDI output access. Receiver validation
cannot prevent memory already consumed while cloning a compromised Worker's message; it bounds all
subsequent processing and effects.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptHost.spec.ts`,
covering unknown, missing, additional, grant-bearing, `NaN`, `Infinity`, empty, oversized,
non-integer, and out-of-range messages. Identifier cases include exact-limit and one-byte-over-limit
ASCII and multibyte `deviceId` and `paramId` values at both the trusted bootstrap and compromised-
Worker host boundary. Rejections prove zero correlation, payload logging, owner lookups, Command
dispatches, MIDI writes, and store writes.

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
`{ scriptId: WorkerProtocolId, apiVersion: supported literal, language: 'javascript' | 'typescript', sourceBytes: Uint8Array }`
with no unknown fields, source URL, blob URL, package/module graph, compiler options, plugin, or
loader hook supplied by the bundle. `sourceBytes` is an ordinary `Uint8Array` backed by an
`ArrayBuffer` rather than a `SharedArrayBuffer`, and its view `byteLength` is at most the
ADR-pinned `MAX_SCRIPT_SOURCE_BYTES = 1_048_576`; only the view's bytes are decoded and hashed.
The bundle record and every JSON-like nested object have only their shown own string keys and no
symbols; the `sourceBytes` indexed storage is the sole typed-byte payload and has no authority
fields.

The host decodes `sourceBytes` first with `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`.
A decoder failure returns `SCRIPT_SOURCE_INVALID` before parsing, canonicalization, digesting, or
runtime creation; the malformed-byte fixture therefore supplies a `Uint8Array` such as
`[0xC3, 0x28]`, not a JavaScript string. After successful decoding, the host preserves the decoded
code points without normalization and constructs the exact canonical source record
`{ scriptId, apiVersion, language, source: decodedSource }`. `sourceDigest` is SHA-256 over the
UTF-8 bytes of that record's RFC 8785 canonical JSON encoding, before parser normalization or
TypeScript compilation; `sourceBytes` is not separately serialized into that record. JavaScript is
parsed as one script. TypeScript is compiled without executing it by the trusted host using the
compiler version and fixed no-module, no-resolution, no-plugin, no-source-map options selected in
AC-002's ADR; any diagnostic returns `SCRIPT_COMPILE_REJECTED` with no emit. The source digest is
therefore compatible with the former string-boundary contract for the same decoded input.

The loader rejects static imports/exports, `require`, `importScripts`, dynamic `import()`, source-
loading directives, and unsupported API/language values as `SCRIPT_SOURCE_INVALID`. It computes
`scriptDigest` as SHA-256 over the emitted JavaScript UTF-8 bytes, retains
`{ sourceDigest, scriptDigest, compiler identity/options }` in the host-private session record, and
uses the accepted ADR's numeric `MAX_SCRIPT_EMITTED_BYTES = 1_048_576` for the emitted-code cap.
Source or emitted JavaScript above its named cap returns `SCRIPT_SOURCE_TOO_LARGE` before runtime
load. These two caps remain separate from the AC-005/AC-010 identifier and diagnostic limits. The
Worker bootstrap accepts only that emitted JavaScript, recomputes `scriptDigest`, and rejects a
mismatch as `SCRIPT_SOURCE_INVALID`. Only the digest-matched emitted JavaScript enters the
ADR-selected runtime, never a native Worker evaluator. Every rejection creates no runtime session,
grant, intent, or effect.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptSource.spec.ts`,
covering exact JavaScript and TypeScript byte inputs, the `[0xC3, 0x28]` fatal-decoder case,
decoded-record RFC 8785/source-digest fixtures, malformed/unknown fields, URL and module-loading
forms, bundle-supplied compiler configuration, compile diagnostics, the 1 MiB source/emitted byte
limits, and proof that rejected source never reaches the selected runtime

### AC-010 — Script results use one closed protocol

The trusted host and Worker bootstrap MUST communicate only through these exact, no-extra-field
envelopes:

| Direction                        | Envelope                                                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host to Worker load              | `{ kind: 'load', requestId, sessionId, scriptId, scriptDigest, apiVersion, source }`, where `source` is only AC-009's emitted JavaScript                                                                                                              |
| Worker to host load success      | `{ kind: 'result', operation: 'load', requestId, sessionId, scriptId, scriptDigest, outcome: 'SCRIPT_READY' }`                                                                                                                                        |
| Host to Worker execution         | `{ kind: 'execute', requestId, sessionId, scriptId, scriptDigest, event }`, where `event` is one exact member of the closed `apiVersion`-owned `ControllerScriptEvent` union                                                                          |
| Worker to host execution success | `{ kind: 'result', operation: 'execute', requestId, sessionId, scriptId, scriptDigest, outcome: 'SCRIPT_EXECUTION_OK', intents }`, where `intents` is an array of at most 256 AC-005 `ControllerScriptIntent` values                                  |
| Worker to host failure           | The correlated result fields for its operation, no `intents`, and one outcome from `SCRIPT_SOURCE_INVALID`, `SCRIPT_SANDBOX_UNAVAILABLE`, `SCRIPT_SANDBOX_VIOLATION`, `SCRIPT_EXECUTION_TIMEOUT`, `SCRIPT_EXECUTION_LIMIT`, or `SCRIPT_RUNTIME_ERROR` |

`requestId`, `sessionId`, and `scriptId` are `WorkerProtocolId` values under AC-005's exact
256-byte limit; `requestId` and `sessionId` are host-generated, while `scriptId`, `scriptDigest`,
`apiVersion`, and `source` are the exact AC-009 values. `scriptDigest` remains exactly 64 lowercase
hexadecimal SHA-256 characters. Fixed `kind`, `operation`, `outcome`, `apiVersion`, and language
strings are their shown or checked-in literals. `source` remains governed by AC-009's separate
source/emitted-code cap, not either reusable Worker string constant. An `apiVersion` is unsupported
until its complete `ControllerScriptEvent` union and exact per-member schemas are checked in. Every
future non-literal string in an event, intent, or result names `WorkerProtocolId`,
`WorkerDiagnostic`, or a tighter exact UTF-8 byte limit in that member's schema; an unbounded
`string` is invalid. The current result union contains no diagnostic field.
AC-009's host-side `SCRIPT_SOURCE_INVALID`, `SCRIPT_SOURCE_TOO_LARGE`, and
`SCRIPT_COMPILE_REJECTED` outcomes occur before a Worker request; callers receive only those typed
outcomes or an AC-010 terminal result, never a raw compiler diagnostic, exception, or Worker object.

The selected runtime adapter maps its ADR-proven denied-global signal to
`SCRIPT_SANDBOX_VIOLATION` even when the real ambient value is absent, and never exposes a native
exception or runtime object. The trusted bootstrap is the only code allowed to call Worker
`postMessage`; it buffers script intents, enforces all result and intent string limits before that
call, and emits exactly one terminal result per accepted bounded request. An oversized AC-005 intent
produces `SCRIPT_EXECUTION_LIMIT` with no `intents`; the bootstrap revalidates echoed identity and
rejects any over-limit value before result construction, and any future diagnostic is truncated to
the longest UTF-8 code-point prefix within
`MAX_WORKER_DIAGNOSTIC_UTF8_BYTES`. The trusted host validates outgoing request strings before
`postMessage` and independently exact-schema-validates every result after structured clone and
before correlation, payload logging, or AC-004 through AC-007 intent processing. Over-limit
`requestId`, `sessionId`, or `scriptId`, an invalid `scriptDigest`, a load-phase intent,
unknown/extra field, wrong correlation, unrecognized outcome, over-limit intent list, duplicate
terminal result, or script-originated message returns `SCRIPT_PROTOCOL_INVALID` and terminates the
session. An AC-005-invalid intent returns `SCRIPT_MESSAGE_INVALID`. Receiver validation cannot
prevent clone allocation by a compromised Worker. Every rejection and non-success outcome causes
zero Command, MIDI, or store effects.

Verify with: the future owning test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptProtocol.spec.ts`,
covering every request/result variant and typed outcome, absent denied globals, malformed and
mis-correlated envelopes, duplicate results, raw script messaging, and intent overflow. Boundary
fixtures cover exact-limit and one-byte-over-limit ASCII and multibyte `requestId`, `sessionId`, and
`scriptId`, a 65-character and non-hex `scriptDigest`, AC-005 intent identifiers, trusted pre-post
enforcement, and independent compromised-Worker rejection after clone. Each future event, intent,
or result string member adds exact-limit and one-byte-over-limit tests for its named bound. All
rejections assert zero correlation, payload logging, intent processing, Command dispatches, MIDI
writes, and store writes.

### AC-011 — Selected-runtime confinement is observed

The confinement integration harness MUST launch the production Worker bootstrap with the exact
runtime/version accepted under AC-002, not a fake Worker, deterministic shim, or API-name stub. The
accepted runtime ADR includes a machine-readable `supportedWorkerMatrix` whose rows have exactly
`{ runtime, runtimeVersion, browser, browserVersion, os, workerKind, bootstrapDigest }`; every
version is an exact value, not `*`, `latest`, or a range, and the live `{ runtime, runtimeVersion,
browser, browserVersion, os, workerKind }` tuple matches one row byte-for-byte before bootstrap.
The ADR also pins a machine-readable `ambientManifest` with exactly these entry fields:

```text
AmbientKey =
  | { kind: "string", value: string }
  | { kind: "symbol", registryKey: string | null, description: string | null, localOrdinal: non-negative safe integer }
AmbientManifestEntry = {
  path: AmbientKey[],
  owner: "own" | "prototype",
  prototypeDepth: non-negative safe integer,
  descriptor: "data" | "getter" | "setter" | "getter-setter",
  valueKind: "undefined" | "null" | "primitive" | "object" | "callable" | "accessor",
  classification: "language-intrinsic" | "script-api" | "data" | "denied"
}
AmbientManifest = {
  roots: ["globalThis"],
  maxDepth: 4,
  maxObjects: 4096,
  maxEntries: 16384,
  entries: AmbientManifestEntry[]
}
```

The harness computes the live manifest with one deterministic predicate: at depth 0 it starts at
`globalThis`; for each data-property object or function at depth 0 through 4 it calls
`Reflect.ownKeys` without invoking getters, records every own key as `owner: "own"` and
`prototypeDepth: 0`, then follows `Object.getPrototypeOf` through `null` and records each prototype
key as `owner: "prototype"` with its 1-based depth. String keys sort by UTF-16 code units; symbol
keys sort by `Symbol.keyFor` (empty when absent), then description (empty when absent), then
`localOrdinal` among symbols on that owner. Data-property object/function values are enqueued once
per object identity; an accessor is never invoked. `localOrdinal`, object count, entry count, and
depth are checked against the named limits, and a limit hit before traversal completes is drift.
The canonical path includes the root and every string or symbol key, so own, inherited,
constructor, prototype, and symbol paths cannot collapse into one entry.

The harness compares the sorted live entries with the ADR entries by all six entry fields. A missing
or extra path, own/prototype change, symbol change, descriptor/value-kind change, classification
change, incomplete traversal, matrix mismatch, bootstrap digest mismatch, or unclassified callable
or authority-bearing object is one manifest drift. A callable is authority-bearing when its
manifest classification is `script-api` or `denied`, or when its object path is one of the ADR's
authority paths; no name-based exception is allowed. Any drift returns the one public outcome
`SCRIPT_SANDBOX_UNAVAILABLE`, emits exactly one AC-010 terminal result, terminates the session, and
never falls back to plain Worker execution.

Before bootstrap, the harness instruments the Worker realm and canary endpoints to observe
constructor calls, network attempts, storage/filesystem access, navigation, child-worker creation,
and every Worker-to-host message. It then executes scripts that probe every manifest entry and, at
minimum, direct and `globalThis`/`self`/constructor/prototype paths to `postMessage`, `fetch`,
`WebSocket`, `XMLHttpRequest`, `EventSource`, `WebTransport`, `BroadcastChannel`, `importScripts`,
IndexedDB, Cache, storage/filesystem APIs, dynamic import, location/navigation, and Worker creation.
Forbidden source forms return the AC-009 source/compile outcome; runtime access and escape attempts
return `SCRIPT_SANDBOX_VIOLATION`. All probes observe zero outbound I/O, zero ambient side effects,
and no host message except the single AC-010 result. Bootstrap absence, integrity failure, or
lockdown failure also returns `SCRIPT_SANDBOX_UNAVAILABLE`. The same proof runs with Worker CSP
relaxed or absent; CSP remains defense in depth.

Verify with: the future owning integration test, run as
`pnpm test:run src/modules/HardwareController/useCases/__tests__/controllerScriptSandbox.spec.ts`,
using the ADR-selected production runtime/bootstrap and asserting the exact matrix-row match,
machine-readable manifest schema, own/inherited/prototype and symbol enumeration, deterministic
sorted-entry comparison, every named traversal limit, drift-to-one-outcome mapping, Worker-side
observation log, exact outcomes, and zero effects

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
