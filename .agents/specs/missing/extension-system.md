# Extension System (Sandboxed Runtime)

## Goal

Let users install, enable, and run third-party extensions that extend the DAW with new commands, script actions, and small UI panels, while guaranteeing that an extension cannot read arbitrary DOM, exfiltrate data over the network, access the filesystem, or mutate project state beyond what its manifest permits. The goal when this ships is: a user can paste a script in the extension editor, click Run, and see side effects (a notification, a new track, a MIDI generation) without any `new Function`, `eval`, same-origin DOM reach, or unchecked action dispatch in the execution path.

## Current state

The entire module is frozen. The store, manifest schema, and permission enum are complete and correct; the runtime is unsafe and must be replaced before any UI is exposed.

What exists:
- `src/modules/Extension/stores/extension.ts` — `ExtensionManifest`, `ExtensionPermission` (15 permission strings), `ExtensionCategory`, `InstalledExtension`, `ScriptCommand`, `ExtensionMarketplaceState`, `extensionStore`.
- `src/modules/Extension/services/scripting.ts` — `appendLog()` (correct), `createDawApi()` (unsafe: casts action to `any`, hands full `executeAppAction` access to guest code, zero permission checks).
- `src/modules/Extension/useCases/extension/` — 12 use-cases: `installExtension`, `uninstallExtension`, `toggleExtension`, `registerCommand`, `executeCommand`, `runEditorScript` (uses `new Function`), `setEditorContent`, `toggleScriptEditor`, `clearConsole`, `getInstalledExtensions`, `getEnabledExtensions`, `getExtensionCommands`.
- Tests cover every use-case and the scripting service in the same-origin execution model.

What is missing:
- Any sandbox (Web Worker, iframe, or WASM runtime).
- Any IPC protocol between host and extension.
- Any enforcement of `ExtensionPermission` at the dispatch boundary.
- A marketplace/install UI.
- `ProjectData.extensions` persistence — extensions are currently in a store but never serialized.
- An extension manifest validator.
- A capability-scoped DAW API (today's `createDawApi` is all-or-nothing).

`src/modules/Extension/stores/extension.ts:1` pins the freeze: "TODO: FROZEN — Extension system is architecturally sound (types, manifest, permissions model) but the runtime is unsandboxed."

## Design

### Isolation approach: dedicated Web Worker per enabled extension

Each enabled extension runs in its own `Worker` instantiated from a blob URL that wraps the extension's source in a deterministic bootstrap. The worker:

- Has no DOM, no `window`, no `document`, no `fetch` unless granted `network` permission.
- Uses `importScripts('blob:...')` exactly once from the bootstrap to install the extension code.
- Communicates with the host only via `postMessage` over its owning `MessagePort`.
- Is terminated on uninstall, disable, or unhandled promise rejection.

### Threat model

| Threat | Mitigation |
|---|---|
| Script reads DOM / `localStorage` | Worker context has no DOM; no `self.location` leak beyond the blob URL. |
| Script exfiltrates data over `fetch` | `fetch`, `WebSocket`, `EventSource` deleted from `self` at bootstrap unless `network` permission is present. |
| Script performs synchronous long-running work | Host sets a watchdog timer (5 s wall-clock per RPC call) and terminates the worker on exceed. |
| Script spawns child workers | `Worker`, `SharedWorker` constructors deleted in bootstrap. |
| Script reaches `indexedDB` | IDB deleted unless `fs:read` or `fs:write`. Even then, access is routed through the host's virtual FS, not direct IDB. |
| Script calls `executeAppAction` with an action its manifest does not permit | Host RPC handler consults the manifest's permission list before dispatching. Reject with `PermissionDeniedError`. |
| Script floods the host with RPC | Rate limit: 60 RPC messages per second per extension, hard cap 500 concurrent pending calls. Breach terminates the worker. |
| Malicious manifest with invalid permissions | Manifest validated at install time against the `ExtensionPermission` union. Unknown strings reject install. |
| Script imports third-party code via `importScripts()` from the network | `importScripts` overridden in bootstrap to throw unless URL is `blob:` and signed by the extension's manifest SHA. |
| Script accesses `crypto.subtle` | Allowed — deterministic and audit-friendly. No side channel to host state. |

### API surface (host → worker, RPC)

The worker exposes no globals except `daw`, `console`, a restricted `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`. The `daw` API is a façade whose every method posts an `rpc_call` message to the host and awaits `rpc_result`.

```ts
type DawApi = {
    // always available
    version: string;
    notify(message: string, kind?: 'info' | 'success' | 'warn' | 'error'): Promise<void>;

    // capability: tracks:read
    listTracks(): Promise<ReadonlyArray<TrackSummary>>;

    // capability: tracks:write
    createTrack(input: { name: string; kind: 'audio' | 'midi' }): Promise<{ id: string }>;
    renameTrack(id: string, name: string): Promise<void>;

    // capability: clips:read / clips:write
    listClips(trackId: string): Promise<ReadonlyArray<ClipSummary>>;
    addMidiNote(clipId: string, note: { pitch: number; startBeat: number; lengthBeats: number; velocity: number }): Promise<void>;

    // capability: transport:read / transport:write
    transport: {
        play(): Promise<void>;
        stop(): Promise<void>;
        getPlayhead(): Promise<number>;
    };

    // capability: network
    // fetch is a whitelisted proxy; URL allowlist from manifest
    fetchText(url: string): Promise<string>;

    // capability: ui:panel — registers a React-less panel renderer via postMessage frames
    registerPanel(id: string, onRender: (frame: PanelFrame) => void): Promise<void>;

    // capability: ui:menu
    registerCommand(spec: { id: string; label: string; handler: () => void | Promise<void> }): Promise<void>;
};
```

### IPC protocol (JSON-only, versioned)

All messages are `{ v: 1, kind, id?, ... }` — never transferable objects, never structured clones of DOM refs.

Host → Worker:
```ts
type HostMessage =
    | { v: 1; kind: 'init'; extensionId: string; manifest: ExtensionManifest; source: string }
    | { v: 1; kind: 'rpc_result'; id: string; ok: true; value: unknown }
    | { v: 1; kind: 'rpc_result'; id: string; ok: false; error: { code: string; message: string } }
    | { v: 1; kind: 'event'; topic: 'transport' | 'selection' | 'project'; payload: unknown }
    | { v: 1; kind: 'invoke_command'; commandId: string }
    | { v: 1; kind: 'render_panel'; panelId: string; width: number; height: number }
    | { v: 1; kind: 'terminate' };
```

Worker → Host:
```ts
type WorkerMessage =
    | { v: 1; kind: 'ready' }
    | { v: 1; kind: 'rpc_call'; id: string; method: string; args: unknown[] }
    | { v: 1; kind: 'log'; level: 'info' | 'warn' | 'error'; message: string }
    | { v: 1; kind: 'register_command'; spec: { id: string; label: string } }
    | { v: 1; kind: 'panel_frame'; panelId: string; ops: PanelOp[] }
    | { v: 1; kind: 'fatal'; error: { message: string; stack?: string } };
```

Panels render via a small display list (no DOM reach):
```ts
type PanelOp =
    | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string }
    | { kind: 'text'; x: number; y: number; text: string; color: string; size: number }
    | { kind: 'button'; id: string; x: number; y: number; w: number; h: number; label: string };
// Host renders to an <canvas> and reports back 'ext_ui_click { buttonId }' on hit-testing.
```

### Permission enforcement

`src/modules/Extension/services/scripting.ts` is replaced with `src/modules/Extension/services/extensionHost.ts` which owns the map `extensionId → Worker + MessagePort + manifest`. Every inbound `rpc_call` goes through:

```ts
function dispatch(extensionId: string, method: string, args: unknown[]): Promise<unknown> {
    const ext = getInstalledExtension(extensionId);
    const required = PERMISSION_FOR_METHOD[method]; // static map
    if (required && !ext.manifest.permissions.includes(required)) {
        throw new PermissionDeniedError(method, required);
    }
    return HOST_METHODS[method](args, { extensionId });
}
```

`PERMISSION_FOR_METHOD` is a single source of truth that pairs every RPC method name with the permission it requires. Adding a method without adding an entry is a TypeScript compile error (enforced via exhaustive `satisfies Record<keyof DawApi, ExtensionPermission | null>`).

### Bootstrap (worker-side, injected verbatim)

```js
// sourdaw-extension-bootstrap.js
(function bootstrap() {
    const pendingRpc = new Map();
    let rpcCounter = 0;
    const nativeFetch = self.fetch;
    delete self.fetch; delete self.XMLHttpRequest; delete self.WebSocket;
    delete self.Worker; delete self.SharedWorker; delete self.indexedDB;
    delete self.importScripts; // re-added conditionally below

    function rpc(method, ...args) {
        const id = String(++rpcCounter);
        return new Promise((resolve, reject) => {
            pendingRpc.set(id, { resolve, reject });
            self.postMessage({ v: 1, kind: 'rpc_call', id, method, args });
        });
    }
    self.daw = makeProxy(rpc); // builds DawApi façade over `rpc`
    self.console = {
        log: (...xs) => self.postMessage({ v: 1, kind: 'log', level: 'info',  message: xs.join(' ') }),
        warn:(...xs) => self.postMessage({ v: 1, kind: 'log', level: 'warn',  message: xs.join(' ') }),
        error:(...xs)=> self.postMessage({ v: 1, kind: 'log', level: 'error', message: xs.join(' ') }),
    };
    self.onmessage = (ev) => {
        const m = ev.data;
        if (m?.kind === 'init') { eval(m.source); /* scoped in IIFE */ self.postMessage({ v:1, kind:'ready' }); }
        else if (m?.kind === 'rpc_result') { const p = pendingRpc.get(m.id); if (p) { m.ok ? p.resolve(m.value) : p.reject(new Error(m.error.message)); pendingRpc.delete(m.id); } }
        else if (m?.kind === 'invoke_command') { self.dispatchEvent(new MessageEvent('command', { data: m.commandId })); }
    };
})();
```

Note: `eval` in the bootstrap is safe because the bootstrap itself runs in an isolated Worker — there is no DOM to escape to. What is unsafe about today's `runEditorScript` is that `new Function` runs in the host window, not that `eval` exists.

### End-to-end call flow

```
 user clicks "Run" in extension editor
   └─► runEditorScript (host use-case)
         └─► extensionHost.runScript(extensionId, source)
               ├─ spawn Worker(bootstrapUrl)
               ├─ postMessage { kind:'init', source }
               └─ await 'ready'
                 ──────────────── worker runs user code ────────────────
                 script calls daw.createTrack(...)
                   └─► postMessage { kind:'rpc_call', method:'createTrack', args }
                 ────────────────  host dispatches  ─────────────────────
                 host checks permissions, runs executeAppAction,
                 replies with { kind:'rpc_result', ok:true, value:{id} }
```

## API surface

```ts
// src/modules/Extension/models/ExtensionHost.ts
export type ExtensionRuntime = {
    extensionId: string;
    worker: Worker;
    startedAt: number;
    rpcCount: number;
};

export type PermissionDeniedError = Error & { code: 'PERMISSION_DENIED'; method: string; required: ExtensionPermission };

// src/modules/Extension/services/extensionHost.ts
export function startExtension(ext: InstalledExtension): Result<ExtensionRuntime, Error>;
export function stopExtension(extensionId: string): void;
export function sendCommand(extensionId: string, commandId: string): void;
export function runEditorScriptInWorker(source: string): Promise<void>;
export function validateManifest(raw: unknown): Result<ExtensionManifest, Error>;

// src/modules/Extension/useCases/extension/*  (new / replacements)
export function installExtension(manifest: ExtensionManifest, source: string): Result<void, Error>;
export function runEditorScript(): Promise<void>; // now async, uses worker
export function executeCommand(commandId: string): void; // posts 'invoke_command' to owning worker

// src/modules/Extension/services/permissionMap.ts
export const PERMISSION_FOR_METHOD = {
    notify: null,
    listTracks: 'tracks:read',
    createTrack: 'tracks:write',
    renameTrack: 'tracks:write',
    listClips: 'clips:read',
    addMidiNote: 'clips:write',
    'transport.play': 'transport:write',
    'transport.stop': 'transport:write',
    'transport.getPlayhead': 'transport:read',
    fetchText: 'network',
    registerPanel: 'ui:panel',
    registerCommand: 'ui:menu',
} as const satisfies Record<string, ExtensionPermission | null>;
```

## UI / UX

- **Extension Manager panel** — new tab in the Command Palette settings drawer. Lists installed extensions with: toggle, permission chips, "Remove" button, last error. Entry point: `src/modules/Workspace/presentations/views/Settings/ExtensionsTab.tsx` (new file).
- **Install flow** — user drops a `.sourdaw-ext.json` bundle (manifest + source). A confirmation modal lists requested permissions and an explicit "I trust this extension" checkbox before activation.
- **Script Editor** — already has store (`editorOpen`, `editorContent`). The Run button now calls the async worker path and streams logs back into `consoleLog`. Panel lives in `src/modules/Workspace/presentations/views/Inspector/ScriptEditorPanel.tsx` (new file).
- **Extension panels** — rendered to an `<canvas>` inside a generic `ExtensionPanelHost.tsx`. Extension sends `PanelOp[]` frames; host redraws on each frame.
- **Keyboard shortcut** — `Cmd/Ctrl + Shift + X` toggles the editor (matches existing palette pattern).

## Data model / persistence

Add to `ProjectData` at `src/modules/Project/models/ProjectData.ts`:

```ts
type ProjectData = {
    // ... existing ...
    extensions?: {
        installed: Array<{
            manifest: ExtensionManifest;
            enabled: boolean;
            installedAt: string;
            lastUpdatedAt: string;
            state: Record<string, unknown>; // JSON-serialisable only
            /** SHA-256 of source, checked on load to detect tamper */
            sourceHash: string;
        }>;
        editorContent?: string;
    };
};
```

Extension **source** is stored in a separate content-addressed store (reuse `AssetTransfer` CAS, keyed by `sourceHash`). Source is **not** embedded in `ProjectData` directly — keeps the project file small and lets the collab layer replicate it out-of-band.

Hydration: extend `hydrateModuleStoresFromProjectData.ts` with an extensions block that: (a) repopulates `extensionStore.installed`, (b) resolves each `sourceHash` from CAS, (c) does **not** auto-start extensions (user must re-enable after load for safety — log a one-time notification).

Migration: none. New optional field.

## Integration points

- `src/modules/Command/useCases/executeAppAction.ts` — no change. Extension RPC calls go through `executeAppAction` only for the `daw.*` methods that map to existing `AppAction`s.
- `src/modules/Command/models/AppAction.ts` — no new actions for the host. Add `{ type: 'toggleExtension'; payload: { extensionId: string; enabled: boolean } }`, `{ type: 'runEditorScript'; payload?: undefined }`, `{ type: 'installExtensionFromFile'; payload: { bundleJson: string } }`.
- `src/modules/Extension/events/index.ts` — publish `ExtensionStarted`, `ExtensionStopped`, `ExtensionCrashed` so the telemetry and logger modules can observe without importing Extension internals.
- `src/infra/logger/appLogger.ts` — emit one logger child namespace per extension: `logger.child({ extensionId })` for clean audit trails.
- `vite.config.ts` — serve the bootstrap JS as a static asset under `/extension-bootstrap.js` with correct CORS + COEP/COOP headers. Bootstrap must be same-origin for the Worker URL constructor to accept it.
- `src/modules/Project/useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData.ts` — wire the new `data.extensions` block.

## Risks / open questions

- **Worker cold-start cost** — spawning a Worker is ~10–30 ms. For an extension with a menu command triggered 100×/session, this is acceptable; for a hot-loop script it is not. Mitigation: keep the worker alive across calls; terminate only on disable.
- **Transferable buffers** — if an extension wants a copy of an audio buffer for analysis, JSON clone of a `Float32Array` is O(n) and allocates. We either accept the cost (small analysis loops only), or extend the protocol with explicit `transfer: [buffer]` lists at specific RPC call sites (e.g. `getClipSamples` would transfer, and the host takes a replacement buffer back).
- **`network` permission scope** — a per-URL allowlist is safer than blanket `network`. Open question: require manifest to declare exact origins? Recommendation: yes, add `networkOrigins?: string[]` to manifest, deny any URL not matching.
- **Bootstrap delivery** — inline the bootstrap source as a string in the bundle (simplest, but inflates bundle ~4 KB) or serve as a static asset (requires Vite config and correct CORS). Recommendation: serve as asset.
- **COOP / COEP** — Worker + `SharedArrayBuffer` together require cross-origin isolation. This repo already uses SAB (`hasSharedArrayBuffer()`). No new requirement; inherit existing headers.
- **Sync vs. async migration of existing tests** — the current `runEditorScript` is synchronous. Switching to Workers makes it async; all tests at `src/modules/Extension/useCases/extension/__tests__/runEditorScript.spec.ts` need to `await` and use fake-timers or a mock worker host.
- **CRDT replication of extensions** — if two peers install different extensions, do they merge? Recommendation: extension install is per-peer, not synced via CRDT. Only `editorContent` syncs. The installed set is a local user setting.

## Milestones

### M1 — Sandbox primitive + bootstrap (one session)
- Add `src/modules/Extension/services/extensionHost.ts`, bootstrap asset, `startExtension/stopExtension`, rate-limiter, watchdog.
- Add `PERMISSION_FOR_METHOD` static map and `dispatch()` permission check.
- Implement `daw.notify` and `daw.listTracks` end-to-end.
- No UI changes. Tests: unit test for permission check, integration test that runs a hello-world script in a real Worker.

### M2 — Full RPC surface (one session)
- Implement every method in `DawApi` against existing `AppAction`s / stores.
- Wire `fetchText` with origin allowlist.
- Replace `new Function` in `runEditorScript.ts` with the new async worker path.
- Tests: one spec per method asserting both the happy path and the permission-denied path.

### M3 — Commands + script console UI (one session)
- Extension-registered commands appear in the Command Palette.
- Log streaming from worker to `consoleLog` with extensionId attribution.
- Wire AppActions `toggleExtension`, `runEditorScript`.
- Tests: command registration round-trip, permission-denied logging.

### M4 — Manifest validation + install UX (one session)
- Zod schema for `ExtensionManifest` including `networkOrigins`.
- Install drop-zone, confirmation modal, permission-chip display.
- Source CAS integration; `sourceHash` verification on load.
- Tests: bad manifests rejected, source tamper detected.

### M5 — Persistence + panel protocol (one session)
- Extend `ProjectData.extensions`, implement hydration, persist `editorContent`.
- Implement `registerPanel` + `PanelOp` renderer.
- One factory example extension (a "Random Melody" extension shipped in `public/extensions/`) to prove the surface end-to-end.
- Tests: round-trip save/load; panel renders buttons and routes clicks back.

## Tests

- **Unit** — every use-case stays covered. `runEditorScript.spec.ts` becomes async with a mock Worker (vitest `import.meta.worker` or a `MockWorker` class that implements `postMessage`/`onmessage`).
- **Permission matrix** — one spec asserts that for every method in `PERMISSION_FOR_METHOD`, denying the permission produces `PermissionDeniedError` and granting it succeeds. Uses `it.each`.
- **Bootstrap isolation** — a Node test instantiates the bootstrap in `node --experimental-vm-modules` and verifies `fetch`, `Worker`, `indexedDB` are undefined; `self.daw` is defined.
- **Rate limit** — send 61 RPC calls in 1 s; assert the worker is terminated and a `fatal` event is published.
- **Watchdog** — script with an infinite loop is terminated at 5 s; the UI shows an error toast and the extension is marked `disabled` with `lastError` populated.
- **Persistence round-trip** — install extension A (enabled), extension B (disabled), save project, reload, assert `installed` list matches and neither started automatically.
- **Manifest validator** — seven cases: unknown permission, missing `minDawVersion`, invalid `networkOrigins` URL, duplicate permissions, empty `id`, non-semver `version`, valid manifest.
- **Tamper detection** — mutate source byte, assert `sourceHash` mismatch rejects load.
- **E2E (Playwright)** — install an extension that registers a "Hello" command, invoke it from the palette, assert the notification appears.
