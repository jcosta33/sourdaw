# Dependency Injection Migration Audit

## Overview

This audit tracks the migration of use cases and repositories to the `inject()` pattern as defined in:
- `docs/01-dependency-injection.md`
- `docs/architecture/03-typescript-module.md` (Section 4.10)

## Current State

| Metric | Count |
|--------|-------|
| **Total Use Cases** | 681 |
| **Total Repositories** | 100 |
| **Use Cases Using `inject()`** | 0 |
| **Repositories Using `inject()`** | 0 |
| **Use Cases Missing Input/Output Types** | 649 |
| **Migration Progress** | 0% |

## Target Pattern

Use cases and repositories should use the `inject()` pattern:

```typescript
import { inject } from '#/infra/di/inject';
import { Logger } from '#/helpers/Logger/Logger';
import { TrackRepo } from '../repositories/TrackRepo';

type AddTrackInput = { name: string; kind: TrackKind };
type AddTrackOutput = Track | null;

export const addTrack = inject(
    { logger: Logger, trackRepo: TrackRepo },
)(({ logger, trackRepo }) =>
    (input: AddTrackInput): AddTrackOutput => {
        // implementation
    }
);
```

## Migration Checklist by Module

### Priority 1: Core Modules (Start Here)

These modules are foundational and should be migrated first.

#### Arrangement Module
- [ ] `useCases/addTrack.ts` - Missing Input/Output types, needs inject()
- [ ] `useCases/removeTrack.ts` - Missing Input/Output types, needs inject()
- [ ] `useCases/createTrack.ts` - Missing Input/Output types, needs inject()
- [ ] `useCases/getAllTracks.ts` - Missing Output type, needs inject()
- [ ] `useCases/getTrackStoreState.ts` - Missing Output type, needs inject()
- [ ] `useCases/setTrackStoreState.ts` - Missing Input type, needs inject()
- [ ] `repositories/track/getTrackState.ts` - needs inject()
- [ ] `repositories/track/setTrackState.ts` - needs inject()
- [ ] `repositories/track/getTrackById.ts` - needs inject()
- [ ] `repositories/track/updateTrack.ts` - needs inject()
- [ ] `repositories/track/updateTracks.ts` - needs inject()
- [ ] `repositories/track/updateClip.ts` - needs inject()
- [ ] `repositories/track/updateClipsOnAllTracks.ts` - needs inject()
- [ ] `repositories/track/mapAllTracks.ts` - needs inject()

#### Transport Module
- [ ] `repositories/transport.ts` - needs inject()

#### Project Module
- [ ] `repositories/project/storageOperations.ts` - needs inject()
- [ ] `repositories/project/downloadProjectFile.ts` - needs inject()
- [ ] `repositories/nativeProjectFiles.ts` - needs inject()
- [ ] `repositories/nativeFileDialog.ts` - needs inject()

#### AudioEngine Module
- [ ] `repositories/createWebAudioEngine.ts` - needs inject()
- [ ] `repositories/deviceNodeFactory.ts` - needs inject()
- [ ] `repositories/audioRecorder/recording.ts` - needs inject()
- [ ] `repositories/audioRecorder/inputMonitoring.ts` - needs inject()
- [ ] `repositories/linkBridge.ts` - needs inject()

### Priority 2: Instrument Modules

#### Fermenter Module
- [ ] `repositories/fermenterPresets.ts` - needs inject()

#### Toaster Module
- [ ] `useCases/createDrumTrackStack.ts` - Missing Input/Output types, needs inject()
- [ ] `useCases/toasterParamBridge.ts` - needs inject()
- [ ] `useCases/loadToasterKit.ts` - Missing Input type, needs inject()
- [ ] `useCases/triggerPad.ts` - Missing Input type, needs inject()
- [ ] `useCases/sequencerPlayback.ts` - needs inject()
- [ ] `useCases/toasterQueries.ts` - Missing Output types, needs inject()
- [ ] `repositories/toasterPresets.ts` - needs inject()

#### GrandBoule Module
- [ ] `useCases/createGrandBouleTrack.ts` - Missing Output type, needs inject()
- [ ] `useCases/triggerGrandBouleNote.ts` - Missing Input type, needs inject()
- [ ] `useCases/releaseGrandBouleNote.ts` - Missing Input type, needs inject()
- [ ] `useCases/setGrandBouleMasterGain.ts` - Missing Input type, needs inject()
- [ ] `useCases/setGrandBouleSustain.ts` - Missing Input type, needs inject()
- [ ] `useCases/setGrandBouleSostenuto.ts` - Missing Input type, needs inject()
- [ ] `useCases/setGrandBouleUnaCorda.ts` - Missing Input type, needs inject()
- [ ] `useCases/setGrandBouleMorphPosition.ts` - Missing Input type, needs inject()
- [ ] `useCases/loadGrandBoulePreset.ts` - Missing Input type, needs inject()
- [ ] `useCases/listGrandBoulePresets.ts` - Missing Output type, needs inject()
- [ ] `useCases/panicGrandBoule.ts` - needs inject()
- [ ] `repositories/grandBoulePresetCatalog.ts` - needs inject()
- [ ] `repositories/grandBouleEngineHandle.ts` - needs inject()
- [ ] `repositories/findBuiltinGrandBoulePreset.ts` - needs inject()

#### Grinder Module
- [ ] `useCases/grinderParamBridge.ts` - needs inject()
- [ ] `useCases/grinderPresets.ts` - Missing Output types, needs inject()

#### Levain Module
- [ ] `repositories/levainPresets.ts` - needs inject()
- [ ] `repositories/sampleLoader.ts` - needs inject()

#### Sampler Module (Crumbs)
- [ ] `useCases/samplerParamBridge.ts` - needs inject()
- [ ] `useCases/loadSample.ts` - Missing Input type, needs inject()
- [ ] `useCases/samplerLifecycle.ts` - needs inject()
- [ ] `useCases/handleFileDrop.ts` - Missing Input type, needs inject()
- [ ] `repositories/samplerBridge.ts` - needs inject()

### Priority 3: Effect Modules

#### Proof Module
- [ ] All use cases - needs inject() pattern
- [ ] All repositories - needs inject() pattern

#### DutchOven Module
- [ ] All use cases - needs inject() pattern
- [ ] All repositories - needs inject() pattern

#### Gluten Module
- [ ] `useCases/glutenParamBridge.ts` - needs inject()
- [ ] `useCases/glutenPresets.ts` - needs inject()

#### Crust Module
- [ ] `useCases/crustParamBridge.ts` - needs inject()
- [ ] `useCases/crustPresets.ts` - needs inject()

#### Bacteria Module
- [ ] `useCases/bacteriaParamBridge.ts` - needs inject()
- [ ] `useCases/bacteriaPresets.ts` - needs inject()

#### Scoring Module
- [ ] `useCases/setA4Reference.ts` - Missing Input type, needs inject()
- [ ] `useCases/setDisplayMode.ts` - Missing Input type, needs inject()

### Priority 4: Automation & MIDI

#### Automation Module
- [ ] `useCases/getAutomationStoreState.ts` - needs inject()
- [ ] `useCases/automationRecording/startAutomationRecording.ts` - needs inject()
- [ ] `useCases/automationRecording/stopAutomationRecording.ts` - needs inject()
- [ ] `useCases/automationRecording/recordAutomationValue.ts` - Missing Input type, needs inject()
- [ ] `useCases/automationRecording/releaseTouchAutomation.ts` - needs inject()
- [ ] `useCases/automation/addAutomationPoint.ts` - Missing Input type, needs inject()
- [ ] `useCases/automation/removeAutomationPoint.ts` - Missing Input type, needs inject()
- [ ] `useCases/automation/updateAutomationPoint.ts` - Missing Input type, needs inject()
- [ ] `useCases/automation/addAutomationLane.ts` - Missing Input type, needs inject()
- [ ] `useCases/automation/removeAutomationLane.ts` - Missing Input type, needs inject()
- [ ] `useCases/automation/toggleLaneCollapsed.ts` - Missing Input type, needs inject()

#### Yeast Module (MIDI FX)
- [ ] `useCases/addYeastProcessor.ts` - Missing Input type, needs inject()
- [ ] `useCases/removeYeastProcessor.ts` - Missing Input type, needs inject()
- [ ] `useCases/setYeastProcessorParam.ts` - Missing Input type, needs inject()
- [ ] `useCases/setYeastProcessorBypass.ts` - Missing Input type, needs inject()
- [ ] `useCases/reorderYeastProcessor.ts` - Missing Input type, needs inject()
- [ ] `useCases/yeastSchedulingBridge.ts` - needs inject()
- [ ] `useCases/processors/Arpeggiator.ts` - needs inject()
- [ ] `useCases/processors/ChordGenerator.ts` - needs inject()
- [ ] `useCases/processors/ScaleQuantizer.ts` - needs inject()

### Priority 5: Command & Collaboration

#### Command Module
- [ ] `useCases/executeAppAction.ts` - Missing Input type, needs inject()
- [ ] `useCases/undoRedo.ts` - Missing Input type, needs inject()
- [ ] `useCases/pushUndoEntry.ts` - Missing Input type, needs inject()
- [ ] `useCases/macro/recording.ts` - needs inject()
- [ ] `useCases/macro/playback.ts` - needs inject()
- [ ] `useCases/macro/management.ts` - needs inject()
- [ ] `useCases/undoTree/recordToTree.ts` - needs inject()
- [ ] `useCases/undoTree/branchOperations.ts` - needs inject()

#### Collaboration Module
- [ ] `useCases/collaborationHandlers.ts` - needs inject()
- [ ] `useCases/collaboration/sessionManagement.ts` - needs inject()
- [ ] `useCases/automergeSync.ts` - needs inject()
- [ ] `useCases/assetTransfer.ts` - needs inject()
- [ ] `repositories/peerConnection.ts` - needs inject()

### Priority 6: AI & Analysis

#### AiRuntime Module
- [ ] `repositories/llmWorker.ts` - needs inject()
- [ ] `repositories/mcpToolAdapter.ts` - needs inject()
- [ ] `repositories/webLlm/engineLifecycle.ts` - needs inject()
- [ ] `repositories/webLlm/toolCalling.ts` - needs inject()
- [ ] `repositories/cloudLlm/cloudInference.ts` - needs inject()
- [ ] `repositories/cloudLlm/keyManagement.ts` - needs inject()
- [ ] `repositories/nativeEngine/lifecycle.ts` - needs inject()
- [ ] `repositories/nativeEngine/completions.ts` - needs inject()
- [ ] `repositories/nativeEngine/streaming.ts` - needs inject()
- [ ] `repositories/voiceTauriAdapter.ts` - needs inject()

#### AudioAnalysis Module
- [ ] `repositories/audioAiEngine.ts` - needs inject()
- [ ] `repositories/browserStemSeparation.ts` - needs inject()

### Priority 7: Data & Persistence

#### CrdtDocument Module
- [ ] `repositories/crdtPersistence.ts` - needs inject()
- [ ] `repositories/nativeCrdtPersistence.ts` - needs inject()
- [ ] `repositories/automergeRepository.ts` - needs inject()

#### SampleLibrary Module
- [ ] `useCases/connectFolder.ts` - Missing Input type, needs inject()
- [ ] `useCases/restoreLibrary.ts` - needs inject()
- [ ] `repositories/libraryPersistence.ts` - needs inject()

#### MIDI Module
- [ ] `repositories/downloadFile.ts` - needs inject()

## Migration Guidelines

### For Use Cases

1. Add proper Input/Output type definitions above the function:
   ```typescript
   type FunctionNameInput = { ... };
   type FunctionNameOutput = ReturnType; // or explicit type
   ```

2. Wrap with `inject()`:
   ```typescript
   export const functionName = inject(
       { logger: Logger, repo: Repo },
   )(({ logger, repo }) =>
       (input: FunctionNameInput): FunctionNameOutput => {
           // existing implementation
       }
   );
   ```

3. Update direct imports of dependencies to use inject map instead

4. For cross-module dependencies, import the use case directly (this is allowed)

### For Repositories

1. Repositories with service dependencies (Logger, EventBus, etc.) should use `inject()`
2. Pure repositories (no dependencies) don't need `inject()`
3. Each repository file should export exactly one function

### Testing

After migration, update tests to use `injectDependencies()`:

```typescript
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { spy } from '#/infra/di/testing/spy';

const { useCase, mocks } = injectDependencies(addTrack, {
    logger: spy<Logger>(),
    trackRepo: spy<TrackRepo>(),
});
```

## Common Issues to Watch For

1. **Module-top-level Container.get() calls** - These race with bootstrap. Convert to `inject()`.
2. **Cross-module store imports** - Keep these as direct imports, they're allowed.
3. **EventBus imports** - Can stay as direct import from `#/app/bootstrap`.
4. **Type-only imports** - Keep as regular imports, don't move to inject map.

## Files That Should NOT Use inject()

- Pure transformers (no dependencies)
- Pure validators (no dependencies)
- Pure services (no dependencies)
- Models (data types only)
- React hooks/components
- Engine classes (AudioWorklet, etc.)
- Hot-path audio code

## Migration Command Reference

```bash
# Find files not using inject()
find src/modules -path "*/useCases/*.ts" -not -name "*.spec.ts" | while read f; do
  if ! grep -q "inject(" "$f"; then
    echo "$f"
  fi
done

# Find files missing Input/Output types
find src/modules -path "*/useCases/*.ts" -not -name "*.spec.ts" | while read f; do
  if ! grep -qE "type \w+Input|type \w+Output" "$f"; then
    echo "$f"
  fi
done
```

## Acceptance Criteria

- [ ] All Priority 1 modules migrated
- [ ] All Priority 2 modules migrated
- [ ] All use cases have explicit Input types
- [ ] All use cases have explicit Output types
- [ ] All repositories with dependencies use `inject()`
- [ ] Tests updated to use `injectDependencies()`
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
