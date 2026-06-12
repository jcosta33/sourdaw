# Extension module audit

## Scope

This audit covers `src/modules/Extension/` in full — `stores/extension.ts`,
`services/scripting.ts`, all 12 use cases under
`useCases/extension/*.ts`, and their tests. It is an adversarial review of
the in-DAW extension/scripting subsystem with explicit attention to
sandbox boundaries, the permission model, lifecycle (install / enable /
uninstall / run), and API-surface stability.

The module ships with a self-described "FROZEN" status (`stores/extension.ts:5-9`)
because the runtime is unsandboxed. The audit treats this status seriously
but still enumerates every defect, since "frozen" without a concrete exit
plan is just unmaintained code that ships.

Out of scope: `Command/executeAppAction` itself, `Notification/notifyUser`,
the cross-cutting `createStore` infrastructure (covered elsewhere) — except
where Extension's misuse of them is the bug.

Related spec: none on disk.
Related audits: none on disk for this module. The cross-cutting
`combined-audit.md` and `webdaw-codebase-audit.md` referenced in the
in-file comments do not exist (`stores/extension.ts:9`,
`services/scripting.ts:11` are dangling links).

---

## Goal

A safe, principled extension subsystem for the DAW:

- **Sandboxed execution.** User scripts and third-party extensions run in
  an isolated context (Worker / iframe + CSP / shadow realm) with no
  access to `window`, `document`, `fetch`, the parent's `globalThis`, or
  the DOM. The host communicates with the sandbox over a typed
  `postMessage` boundary.
- **Permissions enforced at runtime.** The `ExtensionPermission` enum is
  not just metadata; every `daw.*` call from a script is checked against
  the calling extension's declared permissions before reaching
  `executeAppAction` / store / repository code. Unknown or unauthorised
  actions error visibly.
- **Stable, versioned API surface.** `createDawApi()` returns a typed
  object. The shape, semantics, and error contract are documented;
  breaking changes go through a deprecation cycle. The `version` field
  is meaningful (semver, gated against `manifest.minDawVersion`).
- **Auditable provenance.** Every action a script dispatches is tagged
  with `source: 'extension'` (or a per-extension id) so undo, telemetry,
  and the action log can attribute it. Today scripts dispatch as
  `source: 'ai'`, which is wrong.
- **Lifecycle correctness.** Install validates the manifest; enable/disable
  is a real toggle (not a dead boolean); uninstall reclaims commands,
  state, and any timers/handles the extension owns. Persistence
  matches the comment: extension state really does survive a reload.
- **AGENTS.md compliance.** No `as any` / `as unknown as`, no
  positional-arg use cases, services don't mutate stores, internal
  imports are relative, the public surface is curated through a root
  `index.ts`.
- **Behavioural test coverage.** Tests assert the actual contract of
  each use case (what action is dispatched, what permission is
  enforced, what the editor environment exposes), not just `set was
  called` shapes.

Today the module satisfies almost none of this.

---

## Relevant code paths

- `src/modules/Extension/stores/extension.ts`
- `src/modules/Extension/services/scripting.ts`
- `src/modules/Extension/services/__tests__/scripting.spec.ts`
- `src/modules/Extension/useCases/extension/installExtension.ts`
- `src/modules/Extension/useCases/extension/uninstallExtension.ts`
- `src/modules/Extension/useCases/extension/toggleExtension.ts`
- `src/modules/Extension/useCases/extension/getInstalledExtensions.ts`
- `src/modules/Extension/useCases/extension/getEnabledExtensions.ts`
- `src/modules/Extension/useCases/extension/registerCommand.ts`
- `src/modules/Extension/useCases/extension/executeCommand.ts`
- `src/modules/Extension/useCases/extension/getExtensionCommands.ts`
- `src/modules/Extension/useCases/extension/runEditorScript.ts`
- `src/modules/Extension/useCases/extension/setEditorContent.ts`
- `src/modules/Extension/useCases/extension/toggleScriptEditor.ts`
- `src/modules/Extension/useCases/extension/clearConsole.ts`
- `src/modules/Extension/useCases/extension/__tests__/*.spec.ts`

Notable absences:

- **No `index.ts`** at any level of the module. There is no public
  cross-module surface; the module is dormant — no other code in
  `src/` imports it (verified by `grep "from '#/modules/Extension'"`
  returning zero matches).
- **No `handlers/`.** No `AppAction → handler` map exists, so
  Extension functionality is not reachable from the command bus.
  Presentation cannot dispatch `'installExtension'` etc.
- **No `models/`.** The domain types live in `stores/extension.ts`
  alongside the store, which violates the "models are private to the
  module" convention only insofar as the types are also re-exported
  from a future `index.ts`. Today they aren't, so the breach is
  latent.
- **No `repositories/`.** `installExtension` accepts an in-memory
  manifest object. There is no path that fetches a manifest from disk,
  Tauri IPC, the network, or a marketplace. The "marketplace" name in
  `ExtensionMarketplaceState` is aspirational.
- **No presentation views/components.** The "script editor panel"
  referenced by `editorOpen` and `toggleScriptEditor` has no UI in
  this module; consumers don't exist.

---

## Current behavior

**Store.** `extensionStore` is a `createStore<ExtensionMarketplaceState>`
seeded with an empty state plus a default editor stub
(`stores/extension.ts:98-107`). It has **no `storage`** option, so
persistence falls back to `createMemoryStorage` — meaning the
`InstalledExtension.state` field is documented as "persisted across
sessions" (`stores/extension.ts:73`) but is wiped on every reload. The
store also has **no `logger`**.

**Use cases.** Twelve thin functions, each opening with the same
`const state = extensionStore.value; if (!state) return;` guard. The
guard is impossible to trip in practice because the store is seeded
with `initialData` and `createMemoryStorage().get()` returns the seeded
value forever. Every "skip when state is null" branch is dead code, and
the silent `return` means a future bug that does null the store would
fail silently across the whole API.

- `installExtension(manifest)` — appends to `installed[]` if id is
  not already present. Manifest is **not validated**; any object
  shaped as `ExtensionManifest` is accepted. `enabled: true` by
  default. Idempotency via short-circuit `return` (not a re-set).
- `uninstallExtension(id)` — filters `installed` and `commands`. Does
  **not** call any teardown / dispose on extension-owned resources
  (timers, listeners, registered commands' captured closures still
  hold their `daw` API).
- `toggleExtension(id)` — flips `enabled`. The boolean is **never
  read** by any execution path: `runEditorScript`, `executeCommand`,
  and `createDawApi` do not check `enabled`. Disabling an extension
  does nothing.
- `registerCommand(extensionId, id, label, description, handler)` —
  positional 5-arg signature (AGENTS.md violation), key is
  `${extensionId}.${id}`, dedupes by id (last write wins). The
  `handler` is a closure with full lexical access to the script that
  registered it.
- `executeCommand(commandId)` — looks up by id, calls handler, logs
  errors. Does **not** check that the originating extension is still
  installed/enabled. After uninstall, a stale `commands[]` entry
  cannot exist (uninstall filters), but a registered command from a
  *disabled* extension will still execute.
- `getInstalledExtensions()` / `getEnabledExtensions()` /
  `getExtensionCommands()` — pure getters returning live store
  references (no defensive copy).
- `runEditorScript()` — `new Function('console', 'daw', code)` over
  `state.editorContent`, executed in-page. The "sandbox" is a
  `console` shim. Errors are stringified into the log.
- `setEditorContent`, `toggleScriptEditor`, `clearConsole` — UI state.

**Service.** `services/scripting.ts` exports `appendLog` (mutates
the store) and `createDawApi` (builds the runtime API). The latter
returns:

```
{ version: '0.1.0',
  notify: (msg) => notifyUser(msg),
  executeAction: async (action) => executeAppAction(action as AppAction, { source: 'ai' }) }
```

`action as AppAction` is the lone `as` cast in the module; it
forwards an arbitrary `{ type, payload }` to the global action
registry without permission checking, action validation, schema
narrowing, or rate limiting.

**Tests.** Every use case has a `.spec.ts`. They are uniformly shaped:
construct a mock `extensionStore`, invoke the use case, assert
`set` was called with `expect.objectContaining({ … })`. None of them
assert the security contract (no test runs a malicious script and
asserts it cannot reach `window`); none assert the permission model
(because there isn't one); the `runEditorScript` test passes
`editorContent: ''` and verifies that two log messages were emitted —
it never executes a real script via the production `createDawApi`
(it's mocked to `() => ({})`).

---

## Findings

1. **The module ships unsandboxed code execution.** The owning
   comment says "FROZEN" and "do not build further UI"
   (`stores/extension.ts:5-9`), but the code is in `src/`, type-checked,
   bundled, and shipped. Anyone wiring a single `runEditorScript()`
   call into the UI — or, more dangerously, importing/installing
   extensions from a CRDT peer or imported project — gets full
   `new Function` evaluation against the host page. The "frozen"
   notice is in a docstring; it does not prevent use.

2. **The permission model is decorative.** `ExtensionManifest.permissions`
   (`stores/extension.ts:25`, `:36-51`) is defined, typed, and never
   read. There is no enforcement point in `createDawApi`,
   `executeCommand`, `runEditorScript`, or anywhere else. Every script
   has every permission unconditionally.

3. **`createDawApi.executeAction` mis-tags provenance.**
   `services/scripting.ts:48` dispatches with `source: 'ai'`. The valid
   sources are `'manual' | 'prompt' | 'voice' | 'ai'`
   (`Command/useCases/executeAppAction.ts:15`); there is no
   `'extension'`. Undo telemetry, the action log, and any UX that
   distinguishes AI actions from manual will misattribute every
   extension action as if it came from the AI agent.

4. **`as AppAction` cast bypasses the entire action contract.**
   `services/scripting.ts:48` — `action as AppAction` accepts any
   `{ type: string; payload?: unknown }`. The argument is not
   validated against the live `AppAction` discriminated union, not
   narrowed at runtime, and not Zod-checked. Misshapen payloads reach
   handler code that assumes the action contract was honoured;
   handler-level invariants will be silently violated.

5. **`enabled` flag is a dead bit.** `toggleExtension` flips it,
   `getEnabledExtensions` filters by it, but **no execution path
   consults it**. `executeCommand` does not check `enabled` on the
   command's owning extension, and `runEditorScript` does not relate
   to extensions at all (it runs editor content directly). Disabling
   an extension is theatre.

6. **`uninstallExtension` does not run teardown.** Extensions can
   register commands whose `handler` closures retain references to
   the `daw` API and the script's lexical environment. Uninstall
   filters `commands[]` (`uninstallExtension.ts:12`), but:
    - Any `setInterval` / `setTimeout` / event listener the script
      attached to `window`/`document` (it can — `new Function` runs
      with global scope) keeps running. Memory leak + behaviour leak.
    - There is no `onUninstall` / `dispose` lifecycle hook.
    - Re-installing the same extension id silently merges with a
      half-uninstalled one if the script attached side effects.

7. **`registerCommand` lets one extension squat another's id.**
   `registerCommand.ts:15` keys by `${extensionId}.${id}` but the
   public function takes `extensionId` as a *parameter*, not from
   the executing context. Inside `runEditorScript`, the
   `daw` API given to the script today does **not** expose
   `registerCommand` — but the function is a public use case in this
   module's surface; any future wiring (e.g. a thunk in `daw`) that
   forwards `extensionId` from the script payload lets extension A
   register a command in extension B's namespace. The function
   should derive `extensionId` from a trusted execution context, not
   accept it from caller.

8. **`InstalledExtension.state` is documented persistent but is in
   memory only.** `stores/extension.ts:73` —
   `/** Extension state (persisted across sessions) */`. The store is
   constructed (`:98-107`) with no `storage` option, so
   `createStore.ts:7` falls back to `createMemoryStorage`. State is
   wiped on reload. The doc comment lies.

9. **The whole `editorContent` state is lost on reload too.** Same
   root cause: no `storage` configured. A user who types into the
   script editor and refreshes loses their work. (The default
   editor template is hard-coded, so a fresh reload looks fine —
   masking the regression.)

10. **`new Function` is the entire "sandbox".** `runEditorScript.ts:26`.
    The `console` shim shadows `window.console`, but `window`,
    `document`, `globalThis`, `fetch`, `eval`, `Function`,
    `localStorage`, `IndexedDB`, all module-level imports of the host
    page, and `import()` are all reachable. The eslint comment
    `intentional: this use case executes user-authored editor scripts`
    treats this as acceptable; given finding #1, it is not.

11. **`runEditorScript` swallows errors silently.** `runEditorScript.ts:32-34`
    catches everything, stringifies via template literal (so an Error
    object becomes `"Error: …"` without a stack), and continues. There
    is no propagation to the action bus, no `notifyUser`, no
    structured error type. A script that throws has no way to surface
    the failure to the host UX beyond the in-panel console.

12. **`executeCommand` swallows async rejection paths but not sync
    throws-after-await.** `executeCommand.ts:17-23`:
    ```
    const result = cmd.handler();
    if (result instanceof Promise) {
        result.catch(...);
    }
    ```
    A handler that returns a non-Promise thenable, or one that throws
    synchronously after returning a Promise (rare, but possible with
    `async` generators), routes around the `.catch`. Should be
    `Promise.resolve().then(() => cmd.handler()).catch(...)`.

13. **Use-case file violates "one folder per concept" convention.**
    Every use case lives at
    `useCases/extension/<file>.ts` — i.e. one redundant `extension/`
    subdirectory for a module that is itself called `Extension`.
    Other modules in the repo (`AudioAnalysis`, `Command`, etc.)
    place use cases directly under `useCases/`. The `extension/`
    folder adds nothing.

14. **`registerCommand` violates AGENTS.md function signature rule.**
    `registerCommand.ts:3-9` takes 5 positional parameters. AGENTS.md
    "Function Signatures: functions with more than one parameter take
    a single object param" — this requires `RegisterCommandInput`.

15. **`services/scripting.ts` mutates the store — services rule
    violation.** AGENTS.md explicitly states: "Services layer
    (`services/`): Pure, stateless helpers that operate on domain
    types within one module. They … do NOT mutate stores (that's
    `useCases/` or `handlers/`)." `appendLog`
    (`services/scripting.ts:22-34`) calls `extensionStore.set(...)`.
    `appendLog` should live in `useCases/` (or be inlined).
    Symmetrically, `createDawApi` is store-aware-via-`executeAppAction`
    and side-effectful — borderline as a service.

16. **No `index.ts` — module has no public surface.** Other modules
    cannot import this one through the `#/modules/Extension` path.
    Combined with the absent `handlers/`, Extension is unreachable
    from the rest of the app. It is effectively dead code today.
    This is intentional ("FROZEN") but means nothing here is
    exercised by the running app, so type-only changes elsewhere can
    silently rot this module.

17. **Manifest is structural, not validated.** `installExtension`
    accepts any object matching `ExtensionManifest` at compile time.
    There is no Zod schema, no semver check on `version`, no
    `minDawVersion` compatibility test, no permission allow-list
    check, no max-size guard, no signature/integrity check. A
    malicious caller passes `{ minDawVersion: '999.0.0' }` and is
    happily installed.

18. **`ExtensionPermission`, `ExtensionCategory` are string literal
    unions but `ExtensionManifest.main` is unvalidated free text.**
    `stores/extension.ts:23` — `main: string`. There is no convention
    on whether this is a relative path, a URL, an iframe-loadable
    resource, or executable code. The field is unused today; once
    used, it becomes a path-traversal / SSRF surface.

19. **Tests assert mocks, not contracts.** Across all 13 spec files
    the dominant assertion shape is
    `expect(set).toHaveBeenCalledWith(expect.objectContaining({ … }))`.
    Examples: `setEditorContent.spec.ts:40`,
    `toggleScriptEditor.spec.ts:39`, `clearConsole.spec.ts:42`.
    These prove the use case writes *something* to the store; they
    do not exercise the outcome a caller would observe (a real
    `extensionStore.value` mutation, the round-tripped `editorContent`,
    etc.). When the store API changes shape, the tests will not
    catch it.

20. **`runEditorScript` test mocks the very behaviour under test.**
    `runEditorScript.spec.ts:20-23` mocks `createDawApi` to return
    `{}` and asserts the function logs "Running" and "completed". It
    does **not** run an actual script through the real service, so
    the unsandboxed `new Function` evaluator and the `daw` API binding
    are not covered. Combined with finding #10, the most dangerous
    code in the module has zero behavioural test coverage.

21. **Test type-cast escapes (AGENTS.md "soundness" violation).**
    Multiple specs use `null as unknown as ExtensionMarketplaceState`
    or `null as unknown as ExtensionMarketplaceState | null` to mock
    the store value:
    - `runEditorScript.spec.ts:8`
    - `executeCommand.spec.ts:8`
    - `installExtension.spec.ts:8`
    - `getEnabledExtensions.spec.ts:12`
    - `getInstalledExtensions.spec.ts:12`
    - `getExtensionCommands.spec.ts:8`
    - `clearConsole.spec.ts:8`
      AGENTS.md "TypeScript — soundness" forbids `as unknown as …` to
      silence the compiler. Use `null` (the type already permits it
      via `Store<T>.value`).

22. **`getInstalledExtensions` / `getEnabledExtensions` /
    `getExtensionCommands` leak live store references.** They return
    the same array reference held in the store. A consumer that
    mutates the result (`.push`, `.sort`, `.reverse`) corrupts the
    store without going through `set` and without notifying
    subscribers. Defensive copy or `readonly` typing missing.

23. **`extensionStore` has no logger, but its consumers might want one.**
    `createStore` accepts a `logger` (`createStore.ts:5`) and uses it
    for subscriber-callback errors. Without it, errors thrown by a
    React listener watching extension state vanish silently. Other
    modules wire their store to `logger`; Extension does not.

24. **Console log is unbounded in level types but trimmed only at
    write.** `appendLog` keeps the last 100 entries
    (`services/scripting.ts:30`); this is fine. But `clearConsole`
    is the only escape valve, and `consoleLog` is part of the store
    state — a script that emits 100 large strings (each, say, 1 MB)
    persists ~100 MB inside the store snapshot. No per-message size
    cap. Combined with finding #8 (no persistence), this is bounded
    in practice — but if persistence is ever added, the trimming
    strategy needs revisiting.

25. **`executeCommand`'s "Promise instanceof" check is sound but
    fragile.** `executeCommand.ts:18` — `result instanceof Promise`.
    Native promises pass; promise-likes (Bluebird, custom thenables)
    do not. Better:
    `Promise.resolve(cmd.handler()).catch(...)`. Combined with finding
    #12.

26. **`new Date().toISOString()` for `installedAt`/`lastUpdatedAt`
    side-steps the project's clock abstraction.** `installExtension.ts:16-17`,
    `services/scripting.ts:31`. The repo has no project-wide clock
    DI, so this is consistent with the rest of the codebase, but it
    means tests cannot make these timestamps deterministic without
    `vi.useFakeTimers()`. Note for testing.

27. **Domain types live in `stores/`, not `models/`.** The
    `ExtensionManifest`, `ExtensionPermission`, `ExtensionCategory`,
    `InstalledExtension`, `ScriptCommand`, `ExtensionMarketplaceState`
    types are defined and exported from `stores/extension.ts`. AGENTS.md
    "Models (`models/`) are strictly private to their owning module"
    — these are *de facto* models. Their location couples them to the
    store-shape definition. If a `repositories/` is added later (to
    fetch manifests over IPC), it will need to import from
    `stores/extension.ts`, which is already the case for all use
    cases — minor, but it conflates layers.

28. **No telemetry or audit trail for security-relevant events.**
    No log when an extension is installed, enabled, disabled,
    uninstalled, or executes a command. `appendLog` only goes to the
    in-panel console (which is wiped by `clearConsole` and lost on
    reload per finding #8). For a security-sensitive subsystem, this
    is sub-minimum.

29. **No throttle / rate-limit on `daw.executeAction`.** A script in
    a tight loop firing thousands of `setTrackGain` actions per
    second will saturate the action bus, the undo stack, and any
    React re-renderers downstream. The TODO at
    `services/scripting.ts:7` mentions rate-limiting as a pre-ship
    requirement; not present.

30. **No size / time guard on `runEditorScript`.** A script with
    `while(true)` blocks the main thread forever. The host UI hangs.
    A Worker-based runtime would naturally support `terminate()`;
    today there is no path to abort.

---

## Priorities

1. **Sandbox + permission enforcement (findings #1, #2, #4, #10, #29,
   #30).** These are the load-bearing security bugs. Everything else
   is moot if a user can be tricked into running a malicious script
   inside the host page.
2. **Misleading provenance & contract holes (#3, #4, #17).** The
   `as AppAction` cast and the `'ai'` source mis-tag mean even
   authored scripts behave incorrectly w.r.t. undo, telemetry, and
   action validation.
3. **Lifecycle correctness (#5, #6, #8, #9).** "Disabled" doesn't
   disable. "Persisted" doesn't persist. Uninstall doesn't tear down.
   These are pure correctness bugs independent of the sandbox.
4. **Module is unreachable from the rest of the app (#16).** Either
   wire a public surface and `handlers/` (and accept the security
   debt above as blockers), or formally archive the module under
   `_unused/` so it stops accumulating drift.
5. **Test coverage is mock-shaped, not contract-shaped (#19, #20,
   #21).** Combined with #16, the module has neither in-app
   exercise nor honest tests. A regression cannot be caught.
6. **AGENTS.md compliance (#13, #14, #15, #21, #27).** Architectural
   debt that compounds if left unaddressed.

---

## Open issues

### 1. Extension code execution is unsandboxed

**Problem:** `runEditorScript.ts:26` evaluates `editorContent` via
`new Function('console', 'daw', code)`, which runs in the global
scope of the host page. The script can reach `window`, `document`,
`fetch`, `localStorage`, `IndexedDB`, `import()`, every module-level
binding loaded into the page, and the `Function` constructor itself.
The only "sandbox" is shadowing `console`. Today there is no UI
wiring this in, but the function is exported from a use case file —
it is a single import away from being live.

**Representative files:**

- `src/modules/Extension/useCases/extension/runEditorScript.ts:26`
- `src/modules/Extension/services/scripting.ts:40-50`
- `src/modules/Extension/stores/extension.ts:5-9` (FROZEN comment
  acknowledging this)

**Needed:** Move script evaluation into a `Worker` with a strict
CSP-equivalent (Workers don't have DOM access by default, which is
the start). Define a `postMessage`-based protocol for `daw.*` calls
and `console` logging. Decide whether to support synchronous-feeling
APIs via SharedArrayBuffer/Atomics or accept all-async for the
script author. Until this lands, do **not** wire `runEditorScript`
to any UI. Consider gating the export behind a build flag so the
function cannot be reached from production bundles.

### 2. Permissions are declared but not enforced

**Problem:** `ExtensionManifest.permissions` is a typed list of
capability strings (`stores/extension.ts:36-51`). Nothing in
`createDawApi`, `executeCommand`, or `runEditorScript` reads it. A
script declaring `permissions: []` has the same access as one
declaring every permission.

**Representative files:**

- `src/modules/Extension/stores/extension.ts:36-51`
- `src/modules/Extension/services/scripting.ts:40-50`
- `src/modules/Extension/useCases/extension/runEditorScript.ts`

**Needed:** Build a permission check at the `daw.executeAction`
boundary that maps each `AppAction.type` to one or more
`ExtensionPermission` values, and rejects (with an error event sent
back to the script) when the calling extension's manifest lacks the
permission. The mapping table itself is non-trivial — it may belong
in `Command/` since it defines per-action capability semantics.

### 3. `daw.executeAction` mis-tags every action as `'ai'`

**Problem:** `services/scripting.ts:48` —
`executeAppAction(action as AppAction, { source: 'ai' })`. Valid
sources are `'manual' | 'prompt' | 'voice' | 'ai'`
(`Command/useCases/executeAppAction.ts:15`). Extensions are none of
these. The current choice (`'ai'`) misattributes script-driven
actions to the AI agent, polluting undo telemetry and any UX that
distinguishes provenance.

**Representative files:**

- `src/modules/Extension/services/scripting.ts:48`
- `src/modules/Command/useCases/executeAppAction.ts:15`

**Needed:** Add `'extension'` to `UndoSource` (and the
`ExecuteOptions.source` union). Pass it through. Optionally pass
the `extensionId` so action-log entries can attribute to the
specific extension. This crosses module boundaries — coordinate
with the Command module audit.

### 4. `as AppAction` cast bypasses action contract

**Problem:** `services/scripting.ts:48` casts an arbitrary
`{ type: string; payload?: unknown }` to `AppAction` and dispatches.
There is no runtime validation that `type` is a known action, that
`payload` matches the action's payload schema, or that the script
has permission for it. This is the *one* `as` cast in the module
and it's the most dangerous one.

**Representative files:**

- `src/modules/Extension/services/scripting.ts:46-49`

**Needed:** Build a runtime allow-list for action types and a Zod
(or equivalent) validator per type. Reject unknown types and
malformed payloads with a typed error returned to the script.
Combine with issue #2 to gate by permission. Drop the `as` cast.

### 5. `enabled` flag is read by getters but never enforced at execution

**Problem:** `toggleExtension` flips `installed[i].enabled`;
`getEnabledExtensions` filters by it. But `executeCommand` does not
check the owning extension's `enabled` flag, and `runEditorScript`
runs the editor's content with no relationship to any extension.
"Disabling" an extension does not stop its registered commands.

**Representative files:**

- `src/modules/Extension/useCases/extension/executeCommand.ts:10-23`
- `src/modules/Extension/useCases/extension/toggleExtension.ts`

**Needed:** In `executeCommand`, look up the owning extension by
`cmd.extensionId`, check `enabled`, refuse with a logged error
when disabled. Add a test asserting the disabled path.

### 6. `uninstallExtension` does not run a teardown lifecycle

**Problem:** Filtering `installed[]` and `commands[]` does not undo
side effects the script took at install/run time (timers, listeners,
captured closures). There is no `onUninstall` hook on the manifest
or the in-memory extension record.

**Representative files:**

- `src/modules/Extension/useCases/extension/uninstallExtension.ts`
- `src/modules/Extension/stores/extension.ts:65-75` (no dispose
  field on `InstalledExtension`)

**Needed:** Once #1 lands and scripts run in Workers, uninstall
becomes "terminate the worker + clear its state". Until then,
forbid scripts from attaching globals (issue #1 covers this) and
document that the in-memory `commands[]` is the only owned
resource.

### 7. Documented persistence is not implemented

**Problem:** `InstalledExtension.state` is documented "persisted
across sessions" (`stores/extension.ts:73`), and `editorContent` is
clearly meant to survive a reload (it has a default seed that looks
like initial bootstrap). The store is created without a `storage`
option, so `createStore` falls back to memory storage.

**Representative files:**

- `src/modules/Extension/stores/extension.ts:98-107`
- `src/infra/store/createStore.ts:7`

**Needed:** Either pass a real `storage` (IndexedDB / localStorage
via the project's `createStorage*` helpers) and decide what fields
should persist (probably: `installed`, `editorContent`; probably
not: `consoleLog`, `commands` — handlers can't be serialised),
**or** delete the misleading comment and accept memory-only
behaviour. A persisted store also forces a migration story when
`ExtensionManifest` shape evolves.

### 8. `commands` cannot be persisted because they hold function references

**Problem:** `ScriptCommand.handler: () => void | Promise<void>`
(`stores/extension.ts:83`) is a function. Functions are not
JSON-serialisable. Any persistence layer (#7) must either drop
`commands` from the persisted slice or serialise scripts as code
strings re-evaluated on rehydrate (which re-introduces issue #1
on every page load).

**Representative files:**

- `src/modules/Extension/stores/extension.ts:77-84`

**Needed:** Split state. Persisted: `installed`, `editorContent`.
Ephemeral: `commands` (recomputed by re-running each enabled
extension's entry point on load), `consoleLog`, `editorOpen`. This
is also the natural shape for a Worker-based runtime.

### 9. `installExtension` accepts unvalidated manifests

**Problem:** No Zod schema, no semver check on `version`, no
`minDawVersion` compatibility check, no `main` URL/path validation,
no permission allow-list check, no signature verification. The
function takes any structurally-conformant object and trusts it.

**Representative files:**

- `src/modules/Extension/useCases/extension/installExtension.ts:3-24`

**Needed:** Add a Zod schema for `ExtensionManifest` (the project
uses Zod elsewhere). Validate at the entry point. Compare
`minDawVersion` against the running app version (`semver.satisfies`
or equivalent). Reject manifests requesting unknown permissions.
Treat the result as a `Result<InstalledExtension, ManifestError>`
to give callers a recoverable failure path.

### 10. Module has no public surface (no `index.ts`, no `handlers/`)

**Problem:** The module is shaped as if it's been pulled apart
(stores, services, useCases, tests) but never wired into the rest
of the app. No file in `src/` outside this directory imports from
`#/modules/Extension/...` (verified by grep). There is no
`get<Module>Handlers` for the command bus. As a result, type
checks pass but the module is inert and silently drifts.

**Representative files:**

- (absence of) `src/modules/Extension/index.ts`
- (absence of) `src/modules/Extension/handlers/`

**Needed:** Decide. If the FROZEN status holds: move the module to
`_archive/Extension/` (or a clearly-named "not in use" location)
so the build excludes it, and document the resurrection plan.
If it should be live: add a curated `index.ts`, build
`getExtensionHandlers`, add `AppAction` types for
`installExtension`, `runEditorScript`, etc., wire into
`getAppHandlers`, and only then expose UI — *after* issues #1-#4
are resolved. The current half-state is the worst of both options.

### 11. `services/scripting.ts` mutates the store

**Problem:** `appendLog` calls `extensionStore.set(...)`. AGENTS.md
"Services layer (`services/`): Pure, stateless helpers that … do
NOT mutate stores".

**Representative files:**

- `src/modules/Extension/services/scripting.ts:22-34`

**Needed:** Move `appendLog` to `useCases/extension/appendLog.ts`
(one function per file). Adjust the two callers in
`runEditorScript.ts` and `executeCommand.ts`. `createDawApi` is a
borderline service since it produces an object that holds
references to `executeAppAction` and `notifyUser`; keep it in
`services/` only if it can be made stateless (it currently can —
all state lives in the closures it returns).

### 12. `registerCommand` takes 5 positional parameters

**Problem:** AGENTS.md "Function Signatures: functions with more
than one parameter take a single object param. The input type is
named `FunctionNameInput`."

**Representative files:**

- `src/modules/Extension/useCases/extension/registerCommand.ts:3-9`

**Needed:** Refactor to
`registerCommand(input: RegisterCommandInput): void` with the type
declared immediately above. Update `__tests__/registerCommand.spec.ts`
accordingly.

### 13. Tests use `null as unknown as ExtensionMarketplaceState`

**Problem:** Seven spec files cast `null` through `unknown` to
satisfy a type that already permits `null` (the `Store<T>.value`
type is `T | null`). AGENTS.md "TypeScript — soundness" forbids
`as unknown as …` to silence the compiler.

**Representative files:**

- `src/modules/Extension/useCases/extension/__tests__/runEditorScript.spec.ts:8`
- `src/modules/Extension/useCases/extension/__tests__/executeCommand.spec.ts:8`
- `src/modules/Extension/useCases/extension/__tests__/installExtension.spec.ts:8`
- `src/modules/Extension/useCases/extension/__tests__/getEnabledExtensions.spec.ts:12`
- `src/modules/Extension/useCases/extension/__tests__/getInstalledExtensions.spec.ts:12`
- `src/modules/Extension/useCases/extension/__tests__/getExtensionCommands.spec.ts:8`
- `src/modules/Extension/useCases/extension/__tests__/clearConsole.spec.ts:8`

**Needed:** Type the mock store's `value` as
`ExtensionMarketplaceState | null` directly (no `unknown` step).
Drop the cast.

### 14. Tests assert mocks, not contract

**Problem:** Most specs check `set was called with objectContaining(…)`
without observing the actual store-after state, the actual log
output, or any side effect a real consumer would care about. Two
specific instances are particularly weak:

- `runEditorScript.spec.ts` mocks `createDawApi` to return `{}` and
  passes `editorContent: ''`, so the test never executes a script
  through the real evaluator path. The most security-sensitive
  function in the module has no behavioural test.
- `setEditorContent.spec.ts`, `toggleScriptEditor.spec.ts`,
  `clearConsole.spec.ts`, `getEnabledExtensions.spec.ts`,
  `getInstalledExtensions.spec.ts`, `getExtensionCommands.spec.ts`
  each have one happy-path assertion and no edge cases (null state,
  conflicting ids, mutation of returned arrays).

**Representative files:**

- `src/modules/Extension/useCases/extension/__tests__/runEditorScript.spec.ts:36-50`
- `src/modules/Extension/useCases/extension/__tests__/setEditorContent.spec.ts:34-41`
- `src/modules/Extension/useCases/extension/__tests__/toggleScriptEditor.spec.ts:34-40`
- `src/modules/Extension/useCases/extension/__tests__/clearConsole.spec.ts:34-43`

**Needed:** Replace `expect(set).toHaveBeenCalledWith(…)` shape
checks with assertions over `extensionStore.value` after the call
(using a real or thinly-mocked store). For `runEditorScript`, build
a test fixture that runs an actual benign script and asserts:
(a) `console.log` calls land in `consoleLog`, (b) `daw.notify`
reaches `notifyUser`, (c) a script attempting to read `window`
fails (post-sandbox). Today (c) cannot pass — that is the bug.

### 15. Use cases nested under `useCases/extension/`

**Problem:** The `extension/` subfolder under `useCases/` adds a
useless level of nesting for a module already named `Extension`.
Other modules (`AudioAnalysis`, `Command`, `Arrangement`) put use
cases directly under `useCases/`.

**Representative files:**

- `src/modules/Extension/useCases/extension/*.ts` (12 files)

**Needed:** Move each file up one level to `useCases/<file>.ts`.
Update relative imports in the use cases (`../../stores/extension`
→ `../stores/extension`) and in their tests (one fewer `../`).
Mechanical refactor; should be paired with #16.

### 16. Domain types live in `stores/extension.ts`

**Problem:** `ExtensionManifest`, `ExtensionPermission`,
`ExtensionCategory`, `InstalledExtension`, `ScriptCommand`, and
`ExtensionMarketplaceState` are domain models defined in a store
file. The store should depend on the model, not be the model
container. This works today only because no consumer uses
`models/`.

**Representative files:**

- `src/modules/Extension/stores/extension.ts:14-96`

**Needed:** Create `models/Extension.ts` (or a folder of typed
files) holding the domain types. `stores/extension.ts` imports
from `../models/`. `useCases/` imports from `../models/`. Aligns
with "Models are private to their owning module".

### 17. Returned arrays are live store references

**Problem:** `getInstalledExtensions`, `getEnabledExtensions`,
`getExtensionCommands` return `extensionStore.value?.installed ?? []`,
i.e. the same array the store holds. A consumer that mutates the
result corrupts the store without notifying subscribers.

**Representative files:**

- `src/modules/Extension/useCases/extension/getInstalledExtensions.ts:4`
- `src/modules/Extension/useCases/extension/getEnabledExtensions.ts:4`
- `src/modules/Extension/useCases/extension/getExtensionCommands.ts:3`

**Needed:** Either return `ReadonlyArray<…>` (compile-time
protection) or shallow-copy at the boundary (runtime protection).
Document the choice.

### 18. `runEditorScript` swallows errors into a stringified log

**Problem:** `runEditorScript.ts:32-34` catches everything, formats
via `Script error: ${error}` (which loses Error stacks unless
`Error.prototype.toString` gives a useful string), and returns
`void`. There is no way for a UI to detect that the script failed
beyond reading the panel log.

**Representative files:**

- `src/modules/Extension/useCases/extension/runEditorScript.ts:32-34`

**Needed:** Return a `Result<void, ScriptError>` (the project uses
`neverthrow` per user memory). Capture stack via `error instanceof
Error ? error.stack : String(error)`. Surface to caller for UX
treatment (toast, sticky banner, error panel).

### 19. `executeCommand`'s async error handling is incomplete

**Problem:** `executeCommand.ts:17-23` only attaches `.catch` if
the handler returned a native Promise. Promise-likes / thenables /
handlers that throw synchronously after returning a non-Promise
value fall through.

**Representative files:**

- `src/modules/Extension/useCases/extension/executeCommand.ts:16-23`

**Needed:** Wrap with `Promise.resolve().then(() => cmd.handler())
.catch(err => appendLog('error', `Command error: ${err}`))`.
Also: log the command id alongside the error so debugging is
possible with multiple commands queued.

### 20. No throttle / abort path for `runEditorScript`

**Problem:** A script with `while(true) {}` blocks the main thread
forever; the host UI hangs and can only be recovered by closing
the tab. There is no abort signal, no timeout, no execution-budget.

**Representative files:**

- `src/modules/Extension/useCases/extension/runEditorScript.ts`

**Needed:** Once Worker-based execution lands (issue #1), `terminate()`
the worker after a configurable budget. Until then, do not wire
`runEditorScript` to any UI affordance that lets a user trigger it
on potentially-malicious content.

### 21. `daw.executeAction` is unrate-limited

**Problem:** A loop firing thousands of actions per second through
`executeAppAction` saturates the action bus, the undo log, and any
React re-renderers downstream.

**Representative files:**

- `src/modules/Extension/services/scripting.ts:46-49`

**Needed:** Add a token-bucket / sliding-window rate limiter at the
`createDawApi.executeAction` boundary, scoped per extension. Reject
or queue when the bucket is empty. Configurable per-permission
ceilings (writes are tighter than reads).

### 22. `extensionStore` has no `logger` wired

**Problem:** Subscriber-callback errors and React listener errors
are swallowed silently (`createStore.ts:23-26, 33-36`).

**Representative files:**

- `src/modules/Extension/stores/extension.ts:98-107`

**Needed:** Pass the project logger when constructing the store,
matching the pattern used by other stores in the codebase.

### 23. `installExtension` is silently idempotent on duplicate id

**Problem:** `installExtension.ts:9-11` short-circuits on duplicate
id with a bare `return`. The caller has no signal whether the
install succeeded, was skipped, or failed validation. Combined
with #9, this is the worst possible API: callers cannot distinguish
"already installed" from "installed".

**Representative files:**

- `src/modules/Extension/useCases/extension/installExtension.ts:9-11`

**Needed:** Return a `Result<InstalledExtension, InstallError>`
where `InstallError` distinguishes `'duplicate-id'`, `'invalid-manifest'`,
`'permission-denied'`, etc. Callers can branch.

### 24. Stale references to a non-existent audit document

**Problem:** Both `stores/extension.ts:9` and
`services/scripting.ts:11` direct readers to
`.agents/audits/webdaw-codebase-audit.md` for the FROZEN finding.
That file does not exist (`ls .agents/audits/` shows only
`S-02-multi-track-selection.md`, `combined-audit.md`, `deadcode.md`,
and three folders). Readers chasing the link hit a dead end.

**Representative files:**

- `src/modules/Extension/stores/extension.ts:9`
- `src/modules/Extension/services/scripting.ts:11`

**Needed:** Update the reference to `.agents/audits/modules/Extension.md`
(this file) once it lands, or to whichever audit becomes canonical.

---

## Open questions

- [ ] Is the FROZEN status a temporary block until a sandbox is
      built, or is the entire extension subsystem being deprecated?
      The answer determines whether to invest in the issues above
      or to delete the module.
- [ ] If kept, what is the target sandbox technology — Web Worker,
      shadow realm proposal, iframe + CSP? Each has a different
      API design and message-passing surface.
- [ ] Will extensions ever be loaded from third-party sources
      (URL, marketplace, file picker)? If yes, signature verification
      and CSP-loaded code are non-negotiable. If no (only
      user-authored editor scripts), the threat model is narrower.
- [ ] Should the "extension" provenance source live in the Command
      module's `UndoSource` union, or should each script's actions
      be tagged with a per-extension id? Affects the cross-module
      contract.
- [ ] Does any in-progress UI work plan to surface the extension
      panel? If a feature branch is wiring this up, the security
      issues become urgent.
- [ ] What does "extension state" mean operationally — script-set
      key/value pairs, plugin configuration, both? Affects whether
      `Record<string, unknown>` is acceptable or whether each
      extension declares a state schema.

---

## Risks

- **Code execution against the host page.** The biggest risk by an
  order of magnitude. If a developer wires `runEditorScript` to a
  button, or an "Import project" path includes `editorContent` in
  serialised state, anyone who can put bytes in front of a user can
  run arbitrary JavaScript with full DOM access. Issues #1, #4,
  #10 (the latter because the unwired-but-typechecked code is *one
  import away*) compound this. The existing eslint
  `// no-implied-eval -- intentional` comment institutionalises the
  hazard.
- **Provenance pollution and undo corruption.** Issue #3: scripts
  dispatch as `'ai'`, so any undo-attribution UX or telemetry
  treats extension actions as model output. If telemetry is used
  for billing, safety review, or product decisions, the data is
  wrong.
- **Silent dead features.** Issues #5, #7, #8, #9, #16: documented
  behaviours (disabled extensions, persisted state) do not work.
  The first user to discover this loses trust in the module
  (and possibly the surrounding system).
- **Module-rot from being unwired.** Issue #10: since nothing
  imports `Extension`, a refactor in `Command/`, `executeAppAction`,
  `notifyUser`, or `createStore` can land and pass tests without
  catching that it broke the only consumer in this module. The
  module is dead in CI's eyes.
- **Test theatre.** Issues #14, #19, #20: the spec files give a
  false sense of coverage. Each use case has a test that proves
  *something* runs, but the suite would not catch most realistic
  regressions and is silent on the security-critical paths.
- **AGENTS.md drift.** Issues #11, #12, #13, #15, #16: small
  conventions ignored across many files normalise the deviation.
  Once a "frozen" module accumulates this much drift, picking it
  up later is more expensive than deleting and rewriting.

---

## Suggested approaches

- **Decide the future of the module first.** Before any code
  change, get an answer to "is Extension shipping or not?" If not,
  archive (not delete — see safety rules) the directory under a
  clearly-marked location and reference it from a top-level README
  for the area. If yes, the work below is the spec.
- **Sandbox-first.** No correctness work on `runEditorScript` or
  `createDawApi` is worth doing until the evaluation context is a
  Worker. Land the Worker, the postMessage protocol, and the
  permission check (issues #1, #2, #4) as one cohesive change with
  contract tests for each permission boundary.
- **Then provenance + lifecycle.** Issues #3, #5, #6, #9, #23 are
  architecturally cohesive — they all live around "an extension is
  a real entity with a lifecycle, attribution, and state". Do them
  as a second pass.
- **Then persistence + types organisation.** Issues #7, #8, #16,
  #22 split the state into persistent / ephemeral and move types
  to `models/`. Wires up the storage backend.
- **Finally AGENTS.md compliance.** Issues #11, #12, #13, #15,
  #17, #18, #19, #21, #24 — mechanical fixes; do as one sweep at
  the end so the conventions land on a code shape that no longer
  needs rewriting.
- **Test rewrite pass.** Issue #14: with the new (sandboxed,
  permission-checked, persistent) shape, write fresh contract
  tests that exercise the real evaluator with benign and
  adversarial scripts. The current specs become obsolete; do not
  preserve them out of inertia.

---

## Recommendation

Start with **Open question #1**: confirm whether the Extension
module is shipping or being deprecated. The right next step
diverges entirely on that answer.

If **shipping** — start with **issue #10** (decide and wire the
public surface) plus **issue #1** (sandbox). Without these two,
every other fix is wasted because nothing exercises the module
and the most dangerous code is unmitigated. Treat the module as
gated behind a feature flag until issues #1-#4 are *all* resolved
with contract tests. Block any UI wiring until then.

If **deprecating** — move the directory to an archived location
and update the FROZEN comments to reflect the deprecation. Do not
leave an unused, unsandboxed `new Function` evaluator in the
typechecked source tree.

In either case, **issue #24** (broken audit reference) is a
no-cost cleanup that helps the next reader.

---

## Resolved

_No issues resolved yet._
