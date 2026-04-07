# Dependency Injection Migration Audit

## Overview

This audit tracks the migration of use cases and repositories to the `inject()` pattern as defined in:

- `docs/01-dependency-injection.md`
- `docs/architecture/03-typescript-module.md` (Section 4.10)

Only files with **injectable dependencies** (`logger`, `eventBus`) are in scope. Pure functions, engine classes, React hooks/components, transformers, and stores are intentionally excluded — they either have no dependencies or fall outside the `inject()` boundary per architecture rules.

## Current State

| Metric | Count |
| --- | --- |
| **Total Use Case Files** | 681 |
| **Total Repository Files** | 102 |
| **Use Cases With Injectable Deps** | 23 |
| **Repositories With Injectable Deps** | 11 |
| **Files Already Using `inject()`** | 0 |
| **Migration Progress** | 0 / 34 (0%) |

## Excluded Categories (No `inject()` Needed)

These file types import `logger` or `eventBus` but are intentionally excluded:

- **Engine classes** — `AudioEngine/engine/wasmDeviceRegistry.ts`, `AudioEngine/engine/TrackNode.ts`
- **Stores** — `AudioEngine/stores/rave.ts`
- **Transformers** — `AiRuntime/transformers/toolCallParser.ts`
- **React hooks** — `Workspace/presentations/hooks/usePromptExecution.ts`, `AiRuntime/presentations/hooks/useVoiceRecording.ts`

## Target Pattern

```typescript
import { inject } from '#/infra/di/inject';
import { Logger } from '#/infra/logger/Logger';

type DoThingInput = { name: string };
type DoThingOutput = Result | null;

export const doThing = inject({ logger: Logger })(
    ({ logger }) =>
        (input: DoThingInput): DoThingOutput => {
            // implementation
        }
);
```

## Migration Checklist

### Use Cases (23 files)

#### Arrangement

- [ ] `useCases/addTrack.ts` — eventBus
- [ ] `useCases/removeTrack.ts` — eventBus
- [ ] `useCases/preset/presetLoading.ts` — logger

#### AudioEngine

- [ ] `useCases/buildDeviceChain.ts` — logger
- [ ] `useCases/audioDeviceSelection.ts` — logger

#### AiRuntime

- [ ] `useCases/validateActions.ts` — logger
- [ ] `useCases/parsePromptToActions.ts` — logger
- [ ] `useCases/llmOrchestration/lifecycle.ts` — logger
- [ ] `useCases/llmOrchestration/inference.ts` — logger
- [ ] `useCases/dsoEditor/executeDsoEdit.ts` — logger

#### AiGeneration

- [ ] `useCases/aiMidiHandlers.ts` — logger

#### AudioAnalysis

- [ ] `useCases/polyphonicAudioToMidi.ts` — logger

#### Command

- [ ] `useCases/executeAppAction.ts` — logger
- [ ] `useCases/keyboardShortcutActions/handleKeyboardShortcut.ts` — eventBus

#### GrandBoule

- [ ] `useCases/createGrandBouleTrack.ts` — eventBus

#### MIDI

- [ ] `useCases/midiLearn.ts` — logger

#### Project

- [ ] `useCases/versionControl/snapshotHelpers.ts` — logger
- [ ] `useCases/recentProjects.ts` — logger

#### Toaster

- [ ] `useCases/toasterSubscriber.ts` — eventBus, logger
- [ ] `useCases/createDrumTrackStack.ts` — eventBus

#### Transport

- [ ] `useCases/setlist/goToItem.ts` — eventBus

#### Workspace

- [ ] `useCases/shortcutEngine.ts` — eventBus
- [ ] `useCases/togglePanel/zoomOperations.ts` — eventBus

### Repositories (11 files)

#### AudioEngine

- [ ] `repositories/createWebAudioEngine.ts` — logger
- [ ] `repositories/faustDeviceFactory.ts` — logger
- [ ] `repositories/audioRecorder/recording.ts` — logger
- [ ] `repositories/webMidi/messageHandlers.ts` — eventBus

#### AiRuntime

- [ ] `repositories/cloudLlm/cloudInference.ts` — logger
- [ ] `repositories/cloudLlm/keyManagement.ts` — logger
- [ ] `repositories/nativeEngine/lifecycle.ts` — logger
- [ ] `repositories/webLlm/engineLifecycle.ts` — logger
- [ ] `repositories/webLlm/toolCalling.ts` — logger

#### AudioAnalysis

- [ ] `repositories/audioAiEngine.ts` — logger
- [ ] `repositories/browserStemSeparation.ts` — logger

## Migration Guidelines

### For Use Cases

1. Define Input/Output types above the function
2. Wrap with `inject()`, declaring `logger` and/or `eventBus` in the dependency map
3. Replace direct imports of `logger`/`eventBus` with destructured deps from the factory
4. Cross-module use case imports remain as direct imports (allowed)

### For Repositories

1. Only repositories with service dependencies (`logger`, `eventBus`) need `inject()`
2. Pure repositories (no dependencies) stay as-is
3. Each repository file should export exactly one function

### Testing

After migration, update tests to use `injectDependencies()`:

```typescript
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { spy } from '#/infra/di/testing/spy';

const { useCase, mocks } = injectDependencies(addTrack, {
    logger: spy<Logger>(),
    eventBus: spy<EventBus>(),
});
```

### Import Unification

Files currently import `eventBus` from two paths:
- `#/app/bootstrap` (5 files)
- `#/app/registerDependencies` (remainder)

After migration, the `inject()` pattern resolves `eventBus` via the DI container, eliminating both direct imports.

## Acceptance Criteria

- [ ] All 23 use cases migrated to `inject()`
- [ ] All 11 repositories migrated to `inject()`
- [ ] Direct `logger`/`eventBus` imports removed from migrated files
- [ ] Tests updated to use `injectDependencies()` where applicable
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
