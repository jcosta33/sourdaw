# DI, Event Handling, and Error Handling Comprehensive Audit

## Goal

The purpose of this audit is to provide an exhaustive list of architectural violations in the codebase and clear instructions on how to resolve them. This document is intended to be used as a checklist for agents or developers to systematically refactor the codebase.

> **Context update (2026-04-05):** the DI and test primitives (`Container`, `inject()`, `spy`, `injectDependencies`) were redesigned as groundwork before migration began. See `docs/architecture/03-typescript-module.md §4.10` and `docs/06-testing.md §5` for the canonical API. Key facts that inform this audit:
>
> - `Container.get()` now **throws in dev/test** when a token isn't registered (strict mode). Production keeps a lazy-proxy fallback temporarily, but every migration closes one more caller off that fallback.
> - `inject()` resolves and memoizes dependencies on first call; cached until `Container.reset()`. Async dependencies are forbidden at construction time.
> - Tests use `spy<T>()` + `injectDependencies(subject, mocks)`. The latter throws if any dependency is missing a mock.
> - `EventBus` (via `createEventBus<AppEvents>()`) exposes `on('event.name', handler)` and `emit('event.name', payload)` — string keys, typed payloads, no class wrappers.

---

## 1. Dependency Injection Violations

**Standard:** Use the `inject` wrapper for all Use Cases, Repositories, and business-layer functions that depend on container-resolved services. This decouples the logic from its dependencies and facilitates testing by allowing dependencies to be swapped via the container at call time.

### Why it matters right now

In strict mode (dev/test), `Container.getInstance().get(X)` at **module top-level** throws if the token isn't registered when the module evaluates. This catches bootstrap-order bugs that the old lazy-proxy was masking. Every violation below is a potential dev-time crash once you load a spec that transitively imports it.

### How to Resolve (The `inject` Pattern)

1.  **Wrap the function** (Use Case, Repository, etc.) with `inject`.
2.  **Define dependencies** in the first argument object — keys are the names the factory receives, values are classes, other injectables, or plain pass-through values.
3.  **Provide a factory that returns a function.** The inner function is what callers invoke. `inject()`'s return is a callable that, on first call, resolves deps → calls factory(deps) → caches the returned function → calls it with user args.
4.  **Do not declare Promise-valued deps.** `inject()` throws at construction time if any dep is a Promise — resolve the async module before passing it in (typically during bootstrap).

**Example (Incorrect):**

```typescript
const logger = Container.getInstance().get(Logger);
const eventBus = Container.getInstance().get(EventBus);

export const myUseCase = (data: string) => {
    logger.info(data);
    eventBus.emit(new DataEvent(data));
};
```

In dev/test this throws at module load if this file is imported before bootstrap registers `Logger`/`EventBus`. In production it silently returns a lazy proxy that no-ops calls until registration lands — a masked bug.

**Example (Correct):**

```typescript
import { inject } from '#/infra/di/inject';
import { Logger } from '#/helpers/Logger/Logger';
import { EventBus } from '#/helpers/Event/EventBus';
import { DataEvent } from '../events/DataEvent';

export const myUseCase = inject({ logger: Logger, eventBus: EventBus })(({ logger, eventBus }) => {
    return (data: string) => {
        logger.info(data);
        eventBus.emit(new DataEvent(data));
    };
});
```

Note the **curried API**: `inject(deps)(factory)`. The first call takes the dependency map, the second takes the factory. TypeScript infers the resolved types — `logger` is typed as `Logger`, `eventBus` as `EventBus`.

Caller side is unchanged: `myUseCase('hello')`. Dependencies resolve at call time, not import time — the file can load in any order.

### Testing the migrated function

Every migrated injectable gains the canonical test shape:

```typescript
import { describe, it, expect } from 'vitest';
import { spy } from '#/infra/di/testing/spy';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { Logger } from '#/helpers/Logger/Logger';
import { EventBus } from '#/helpers/Event/EventBus';
import { DataEvent } from '../events/DataEvent';
import { myUseCase } from './myUseCase';

describe('myUseCase', () => {
    it('should log the data and emit a DataEvent', () => {
        const logger = spy<Logger>();
        const eventBus = spy<EventBus>();

        injectDependencies(myUseCase, { logger, eventBus });

        myUseCase('hello');

        expect(logger.info).toHaveBeenCalledWith('hello');
        expect(eventBus.emit).toHaveBeenCalledWith(expect.any(DataEvent));
    });
});
```

No `vi.mock()`. No casts. No `beforeEach` — `injectDependencies` resets the container and validates the mock map on every call.

### Violation List

#### Logger & EventBus Violations (using `Container.getInstance().get()`)

- [ ] `src/modules/Bacteria/stores/bacteriaStore.ts:10` (Logger)
- [ ] `src/modules/Gluten/stores/glutenStore.ts:10` (Logger)
- [ ] `src/modules/Routing/stores/sidechainStore.ts:10` (Logger)
- [ ] `src/modules/Yeast/stores/yeastStore.ts:22` (Logger)
- [ ] `src/modules/Command/useCases/executeAppAction.ts:7` (Logger)
- [ ] `src/modules/Automation/stores/automationStore.ts:10` (Logger)
- [ ] `src/modules/Command/stores/undoTree.ts:11` (Logger)
- [ ] `src/modules/Command/stores/undoStore.ts:6` (Logger)
- [ ] `src/modules/Command/stores/macroStore.ts:9` (Logger)
- [ ] `src/modules/Scoring/stores/scoringStore.ts:17` (Logger)
- [ ] `src/modules/Crust/stores/crustStore.ts:9` (Logger)
- [ ] `src/modules/AiGeneration/useCases/aiMidiHandlers.ts:26` (Logger)
- [ ] `src/modules/SampleLibrary/stores/libraryStore.ts:10` (Logger)
- [ ] `src/modules/AiGeneration/stores/aiStore.ts:34` (Logger)
- [ ] `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:9` (Logger)
- [ ] `src/modules/AudioEngine/repositories/faustDeviceFactory.ts:16` (Logger)
- [ ] `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:25` (Logger)
- [ ] `src/modules/Project/useCases/versionControl/snapshotHelpers.ts:8` (Logger)
- [ ] `src/modules/Project/useCases/recentProjects.ts:12` (Logger)
- [ ] `src/modules/AudioEngine/useCases/audioDeviceSelection/deviceSelection.ts:12` (Logger)
- [ ] `src/modules/AudioEngine/engine/TrackNode.ts:10` (Logger)
- [ ] `src/modules/AudioEngine/useCases/buildDeviceChain.ts:8` (Logger)
- [ ] `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:35` (Logger)
- [ ] `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:36` (EventBus)
- [ ] `src/modules/AudioEngine/stores/audioWarp.ts:11` (Logger)
- [ ] `src/modules/AudioEngine/stores/audioGraphStore.ts:6` (Logger)
- [ ] `src/modules/AudioEngine/stores/controlSurface.ts:11` (Logger)
- [ ] `src/modules/AudioEngine/stores/rave.ts:15` (Logger)
- [ ] `src/modules/AudioEngine/stores/controlRoom.ts:11` (Logger)
- [ ] `src/modules/AudioEngine/stores/linkStatusStore.ts:5` (Logger)
- [ ] `src/modules/Plugin/ProofChamber/stores/chamberStore.ts:6` (Logger)
- [ ] `src/modules/Plugin/stores/nodeView.ts:11` (Logger)
- [ ] `src/modules/Plugin/stores/pluginScanStore.ts:11` (Logger)
- [ ] `src/modules/Project/presentations/views/ExportDialog.tsx:27` (Logger)
- [ ] `src/modules/Plugin/stores/push.ts:17` (Logger)
- [ ] `src/modules/Project/stores/projectStore.ts:8` (Logger)
- [ ] `src/modules/Project/stores/versionControlStore.ts:6` (Logger)
- [ ] `src/modules/Synth/stores/cvGate.ts:13` (Logger)
- [ ] `src/modules/Project/stores/arrangementStore.ts:17` (Logger)
- [ ] `src/modules/Levain/stores/levainStore.ts:21` (Logger)
- [ ] `src/modules/Workspace/presentations/hooks/usePromptExecution.ts:35` (Logger)
- [ ] `src/modules/Workspace/stores/preferencesStore.ts:7` (Logger)
- [ ] `src/modules/Workspace/models/Shortcuts.ts:54` (Logger)
- [ ] `src/modules/Workspace/stores/workspaceStore.ts:6` (Logger)
- [ ] `src/modules/SoundLibrary/stores/sampleDatabaseStore.ts:20` (Logger)
- [ ] `src/modules/AudioAnalysis/repositories/audioAiEngine.ts:17` (Logger)
- [ ] `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts:13` (Logger)
- [ ] `src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts:20` (Logger)
- [ ] `src/modules/MIDI/useCases/midiLearn.ts:21` (Logger)
- [ ] `src/modules/CrdtDocument/stores/branchStore.ts:8` (Logger)
- [ ] `src/modules/CrdtDocument/stores/actionHistoryStore.ts:6` (Logger)
- [ ] `src/modules/Fermenter/stores/fermenterStore.ts:12` (Logger)
- [ ] `src/modules/MIDI/stores/midiLearnStore.ts:5` (Logger)
- [ ] [All other instances previously listed in the previous version of this audit]

---

## 2. Event Handling Violations

**Standard:** Use the Domain `EventBus` for cross-module/application logic. Move event triggers from UI layer (hooks/components) to **Use Cases**.

### How to Resolve

1.  **Define a typed event payload:** Create a typed payload type in the module's `events/` folder (e.g., `ExportStartedPayload`) and add it to the `AppEvents` map in `app/registerDependencies.ts`.
2.  **Move Logic to Use Case:**
    - Identify the action being performed (e.g., toggling a panel).
    - Create/Update a **Use Case** to perform this action.
    - Import `eventBus` from `#/app/bootstrap`.
    - Call `void eventBus.emit('export.started', payload)` from the Use Case.
3.  **Update UI:**
    - The hook or component should only call the Use Case.
    - Example: Instead of `document.dispatchEvent(new CustomEvent('sourdaw:open-export'))`, call `openExportUseCase()`.
4.  **Subscribe via EventBus:**
    - In `AppShell.tsx` or other listeners, replace `document.addEventListener` with `eventBus.on('export.started', handler)`. The `on()` method returns an unsubscribe function.

### Violation List

#### Application Logic Triggered via DOM Events

- [ ] `src/modules/Command/presentations/hooks/useGlobalKeyboardShortcuts.ts:127` (Voice command - should be Use Case)
- [ ] `src/modules/Command/presentations/hooks/useGlobalKeyboardShortcuts.ts:155` (Scroll to playhead - should be Use Case)
- [ ] `src/modules/Command/models/commands/projectCommands.ts:33` (OPEN_EXPORT - should be Use Case)
- [ ] `src/modules/Project/presentations/views/RecentProjectsMenu.tsx:114` (open-export)
- [ ] `src/modules/Workspace/presentations/views/Transport/PanelToggles.tsx:186` (open-preferences)
- [ ] `src/modules/Workspace/useCases/togglePanel/zoomOperations.ts:10` (zoom-to-fit)

#### UI Listeners for Domain Logic (Move to EventBus)

- [ ] `src/modules/Workspace/presentations/views/AppShell.tsx:180-304` (Tab switching listeners)
- [ ] `src/modules/Workspace/presentations/hooks/useAppEventHandlers.ts:41-47` (Save, Undo, Redo, etc.)
- [ ] `src/modules/Workspace/presentations/components/NotificationToast.tsx:33` (sourdaw:notify)

---

## 3. Error Handling Violations

**Standard:** Use domain-specific errors instead of generic `Error`. Errors are created via `createAppError()` from `#/infra/errors/createAppError` — plain `Readonly` objects, not class instances.

### How to Resolve

1. **Define Domain Error:** Create a typed error using `createAppError` in the module's `errors/` folder:

```typescript
import { createAppError, type AppError } from '#/infra/errors/createAppError';
export type MyModuleError = AppError<'MyModule', { detail: string }>;
export const createMyModuleError = (detail: string): MyModuleError =>
    createAppError('MyModule', `Something went wrong: ${detail}`, { detail });
```

2. **Replace Throw:** Replace `throw new Error('msg')` with the appropriate `createMyModuleError('msg')` call (either throw it or return it via `Result`).

### Violation List

- [ ] `src/modules/AiGeneration/useCases/generateMidiVariations.ts:24, 29`
- [ ] `src/modules/AudioEngine/useCases/offlineRender.ts:29, 39`
- [ ] `src/modules/CrdtDocument/useCases/sdawFileFormat.ts:82, 87, 96`
- [ ] `src/modules/AiRuntime/useCases/sendChatMessage.ts:96, 99, 102, 105`
- [ ] (Refer to exhaustive list in section 3 of previous turns)

---

## 4. Heavy Hooks Refactoring Checklist

**Standard:** Hooks should delegate business logic to Use Cases wrapped in `inject`.

### `useGlobalKeyboardShortcuts.ts`

- [ ] Create `ExecuteKeyboardShortcut` Use Case wrapped in `inject`.
- [ ] Move key-to-action mapping from the hook to the Use Case.
- [ ] Inject necessary dependencies (e.g., `trackStore`, `workspaceStore`, `eventBus`) into the Use Case.
- [ ] Replace `document.dispatchEvent` calls in the Use Case with `eventBus.emit()`.
- [ ] Update the hook to only listen for `keydown` and call the Use Case.
