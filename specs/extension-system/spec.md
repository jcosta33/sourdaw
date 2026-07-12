---
type: spec
id: SPEC-extension-system
title: Extension system — sandboxed third-party runtime
status: draft
owner: The Sourdaw team
sources:
  - specs/extension-system/
---

# Extension system — sandboxed third-party runtime

## Intent

Run third-party extensions in a dedicated Web Worker per extension, exposing a
versioned host API (`DawApi`) over a JSON-only IPC protocol with per-permission
enforcement, so an extension can extend the DAW without reaching the main
thread, DOM, or any capability it was not granted.

## Non-goals

- Native (Rust/WASM) extension binaries; v1 is JavaScript in a Worker only.
- Synchronous host calls; all `DawApi` calls are async over `postMessage`.
- A marketplace or remote install source; v1 installs from a local file.

## Requirements

### AC-001 — Each extension runs in its own isolated Worker

The host must spawn one dedicated Web Worker per installed extension with no
access to the main thread's globals, DOM, or other extensions' state.

Verify with: `pnpm test:run -- extensionWorkerIsolation`

### AC-002 — Host calls cross only via a versioned JSON IPC protocol

Worker↔host messages must be JSON-serializable and carry a protocol version.

Verify with: `pnpm test:run -- extensionIpcProtocol`

### AC-003 — Every DawApi call is gated by a declared permission

A `DawApi` call must be rejected by the host unless the extension's manifest
declares the matching permission.

Verify with: `pnpm test:run -- extensionPermissionEnforcement`

### AC-004 — An ungranted call is denied without side effects

When an extension calls an API for a permission it lacks, the host must return a
denial and perform no part of the requested operation.

Verify with: `pnpm test:run -- extensionPermissionDenial`

### AC-005 — A bootstrap script defines the in-Worker API surface

The Worker must load a host-provided bootstrap that exposes only the `DawApi`
methods, with no `eval` of host code and no direct port to native bridges.

Verify with: `pnpm test:run -- extensionBootstrap`

### AC-006 — Installed extensions round-trip through the project file

The set of installed extensions and their granted permissions must save with the
project and restore on reload.

Verify with: `pnpm test:run -- extensionPersistence`

### AC-007 — An Extension Manager lists, installs, and removes extensions

The UI must provide an Extension Manager showing installed extensions, their
permissions, and install/remove/enable controls.

Verify with: `manual` — install a test extension, grant a permission, confirm it appears and runs; remove it

### AC-008 — Extension panels render in a host-controlled container

An extension's UI panel must render in a host-managed container that the
extension cannot escape to reach the main DOM.

Verify with: `manual` — open a test extension panel, confirm it renders sandboxed and cannot touch the app chrome

### AC-009 — A crashing or hung Worker is contained

If an extension Worker throws, hangs, or floods messages, the host must isolate
or terminate it without affecting the app or other extensions.

Verify with: `pnpm test:run -- extensionWorkerFailure`

### AC-010 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-011 — The host rejects an unknown or incompatible protocol version

The host must reject a message with an unknown or incompatible protocol version.

Verify with: `pnpm test:run -- extensionIpcProtocol`

### AC-012 — An invalid manifest is rejected at install time

`installExtension` must validate the raw manifest before activation and reject
it when any declared permission is not a member of the `ExtensionPermission`
union (an unknown permission string must fail the install). Validation must
return a `Result<ExtensionManifest, Error>` rather than accepting any
structurally-conformant object.

Verify with: `pnpm test:run -- extensionManifestValidation`

### AC-013 — Stored extension source is tamper-checked on load

The project must store a SHA-256 hash of each extension's source, and the host
must verify that hash when the project loads. A source whose recomputed hash
does not match its stored hash must be rejected, not run.

Verify with: `pnpm test:run -- extensionSourceTamper`

### AC-014 — Install requires explicit per-permission consent

Before an extension is activated, the install flow must present the extension's
requested permissions and require an explicit affirmative consent step ("I trust
this extension"). An extension must not activate without that consent.

Verify with: `manual` — drop a test extension bundle, confirm the permission list and trust checkbox gate activation; decline and confirm it does not run

### AC-015 — Hydration must not auto-start extensions

On project load, restoring the installed-extension set must not start any
extension automatically; a previously-enabled extension must require an explicit
user action to run again after a reload.

Verify with: `pnpm test:run -- extensionPersistence`

### AC-016 — The DawApi version is gated against the manifest's minimum

The `DawApi` `version` field must be a semantic version and the host must refuse
to activate an extension whose manifest `minDawVersion` exceeds the current
`DawApi` version. Breaking changes to the API surface must go through a
deprecation cycle rather than removing a method outright.

Verify with: `pnpm test:run -- extensionApiVersionGate`

### AC-017 — Security-relevant lifecycle events are recorded to an audit trail

The host must record a durable, attributable log entry when an extension is
installed, enabled, disabled, uninstalled, or executes a command. These entries
must survive beyond the in-panel console (which is cleared by the user and lost
on reload).

Verify with: `pnpm test:run -- extensionAuditTrail`

### AC-018 — The script editor has a keyboard toggle

A keyboard shortcut (`Cmd/Ctrl + Shift + X`) must toggle the script editor open
and closed.

Verify with: `manual` — press Cmd/Ctrl+Shift+X, confirm the script editor toggles open then closed

## Known risks

<!-- Present-state observations carried from audits/modules/Extension.md.
     Observation-only: what is true in the current code, with file:line. -->

- `executeCommand`'s rejection handling is fragile: `executeCommand.ts:18` gates
  on `result instanceof Promise`, so native promises route through `.catch` but
  promise-likes / thenables (and a sync throw after returning a Promise) escape
  it. Wrapping with `Promise.resolve(cmd.handler()).catch(...)` would cover both
  (audit findings #12, #25).

## Open questions

- [ ] (blocking) Worker cold-start latency: is spawning a Worker per extension
  on demand acceptable, or must a warm pool be maintained for responsiveness?
- [ ] (blocking) Network permission scope — is it all-or-nothing, or
  allow-listed by origin? This shapes the manifest schema and enforcement.
- [ ] (non-blocking) Transferable buffers for audio/binary payloads vs
  JSON-only: does the JSON-only rule need a typed-array escape hatch?
- [ ] (non-blocking) (restored detail) Bootstrap delivery — inline the bootstrap
  source as a string in the bundle (simplest, ~4 KB bloat) or serve it as a
  same-origin static asset (requires Vite config + correct CORS). The Worker URL
  constructor needs the bootstrap to be same-origin either way.
- [ ] (non-blocking) (restored detail) A shipped factory example extension (e.g.
  a "Random Melody" extension under `public/extensions/`) to prove the panel +
  command surface end-to-end, with a test that its panel renders and routes
  clicks. Was the M5 milestone deliverable in the prior design.

## Resolved decisions

<!-- Cross-cutting decisions carried from the prior design's Risks section
     (restored detail) — recorded so they have a home, not re-opened. -->

- (restored detail) Extension install is **per-peer, not CRDT-synced**: the
  installed set is a local user setting; only `editorContent` syncs across peers.
- (restored detail) `crypto.subtle` is **allowed** inside the extension Worker —
  it is deterministic and has no side channel to host state.
- (restored detail) COOP/COEP cross-origin isolation is **inherited** from the
  app's existing `SharedArrayBuffer` headers; the extension Worker adds no new
  header requirement.

## Affected areas

- `src/modules/Extensions/host/` (`ExtensionHost`, Worker spawn, IPC)
- `src/modules/Extensions/api/` (`DawApi`, permission gate, bootstrap)
- `src/modules/Extensions/presentations/views/` (Extension Manager, Script Editor, panel host)
- `src/modules/Project/useCases/projectPersistence/` (installed-extension state)

## Dropped from sources

- A built-in Script Editor with full IDE features — v1 ships a minimal editor;
  rich editing is a follow-up.
- Remote/marketplace install sources — local-file install only in v1.
- Native (WASM) extension support — JavaScript Workers only for now.
