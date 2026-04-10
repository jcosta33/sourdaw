# Module `index.ts` Boundary Audit

## Overview

Canonical rules: `docs/architecture/03-typescript-module.md` §3.3 and §5.1. Each module’s root **`index.ts`** is the sole cross-module import target; it may re-export only from **`useCases/`**, **`events/`**, **`stores/`**, and **`presentations/views/`** (curated). From **`useCases/`**, re-export **functions** only — not **`export type`** (see `AGENTS.md`). The module root `index.ts` is the only permitted barrel-style file.

This audit documents:

1. Non-root `index.ts` files under `src/modules/` and how to treat them
2. Cross-module direct-folder imports (1 190 violations), grouped by target module, with paths to fold into each module’s root `index.ts` re-exports

---

## 1. Existing Non-Root `index.ts` Files

Only two `index.ts` files exist under `src/modules/`. Neither is at a module root.

### `AudioEngine/repositories/webMidi/index.ts`

A barrel inside a **repository** subfolder. Contents:

```ts
export { type MidiInputInfo, type WebMidiState } from '../../models/WebMidiTypes';
export { webMidiStore } from './store';
export { initWebMidi, selectMidiInput, setMidiInputTrack, setMpeEnabled, resetMidiState } from './lifecycle';
```

**Problem:** Exports types from `models/` and a store — not a use case. This is intra-module organisation for a repository directory, not a public contract surface. It does not satisfy the new module-root `index.ts` requirement.

**Action:** Keep as an intra-module convenience barrel (not a cross-module import target). AudioEngine still needs a root `index.ts` for its public surface.

---

### `Workspace/presentations/views/Inspector/layouts/index.ts`

A side-effect registration barrel:

```ts
import './BuiltinSynthLayout';
import './FaustInstrumentLayout';
import './HammondB3Layout';
import './effects';
```

**Action:** Keep as-is. It is intra-module (within `presentations/views/`) and not a cross-module import target.

---

## 2. Cross-Module Violations by Target Module

Format per entry: `` `path` ← ImportingModule, ... ``

Total: **1 190 violations** across **33 target modules** from **29 source modules**.

---

### AiGeneration — 13 paths, 17 unique cross-module import relationships

Needs `index.ts` exporting:

- `stores/aiStore.ts` ← AiRuntime, Workspace
- `useCases/actions/handleAiDenoiseClip.ts` ← Arrangement, Workspace
- `useCases/actions/handleGenerateAudioFallback.ts` ← AiRuntime
- `useCases/actions/handleGenerateMidiPrompt.ts` ← AiRuntime
- `useCases/actions/handleStemSeparationPreview.ts` ← AiRuntime, Workspace
- `useCases/actions/removeTask.ts` ← AiRuntime
- `useCases/actions/toggleAiPanel.ts` ← AiRuntime, Workspace
- `useCases/aiMidiHandlers.ts` ← Command
- `useCases/generateChordProgression/applyToTrack.ts` ← AiRuntime
- `useCases/generateDrumPattern/applyToTrack.ts` ← AiRuntime
- `useCases/generateMelody/applyToTrack.ts` ← AiRuntime
- `useCases/generateMidiVariations.ts` ← Workspace
- `useCases/generationHandlers.ts` ← Command

---

### AiRuntime — 22 paths, 26 unique cross-module import relationships

**Note:** 6 paths are `presentations/views/` — promote via the owning module’s root `index.ts`.

Needs `index.ts` exporting:

- `presentations/views/AiActionHistoryPanel.tsx` ← Workspace `[view]`
- `presentations/views/AiChangeToast.tsx` ← Workspace `[view]`
- `presentations/views/ChatPanel.tsx` ← Workspace `[view]`
- `presentations/views/GenerativeAiPanel.tsx` ← Workspace `[view]`
- `presentations/views/MixAnalysisPanel.tsx` ← Workspace `[view]`
- `presentations/views/VoiceCommandOverlay.tsx` ← Workspace `[view]`
- `stores/aiActionHistoryStore.ts` ← Workspace
- `stores/llmStatusStore.ts` ← Workspace
- `stores/voiceStatusStore.ts` ← Workspace
- `useCases/aiOrganizationHandlers.ts` ← Command
- `useCases/aiRuntimeQueries.ts` ← AiGeneration, AudioAnalysis, Workspace
- `useCases/cloudApiManagement.ts` ← Workspace
- `useCases/getProjectContext.ts` ← Workspace
- `useCases/llmOrchestration/backendResolution.ts` ← AiGeneration, Workspace
- `useCases/llmOrchestration/inference.ts` ← AiGeneration
- `useCases/llmOrchestration/lifecycle.ts` ← Workspace
- `useCases/musicMentor/generateLessons.ts` ← Arrangement
- `useCases/notifyAiChange.ts` ← Workspace
- `useCases/parsePromptToActions.ts` ← Workspace
- `useCases/promptInjection.ts` ← Arrangement, Workspace
- `useCases/runAiActionWithToast.ts` ← Arrangement
- `useCases/voiceToggle.ts` ← Workspace

---

### Arrangement — 122 paths, 211 unique cross-module import relationships

The most violated module. **8 paths are `presentations/views/`** — promote via the owning module’s root `index.ts`.

Needs `index.ts` exporting:

- `presentations/views/ArrangementBar.tsx` ← Workspace `[view]`
- `presentations/views/BeatRulerBar.tsx` ← Workspace `[view]`
- `presentations/views/MarkerLane.tsx` ← Workspace `[view]`
- `presentations/views/MidiLearnButton.tsx` ← Workspace `[view]`
- `presentations/views/TimelineChromeSurface.tsx` ← Workspace `[view]`
- `presentations/views/TimelineMinimap.tsx` ← Workspace `[view]`
- `presentations/views/TimelineSurface.tsx` ← Workspace `[view]`
- `presentations/views/TrackListView.tsx` ← Workspace `[view]`
- `stores/chordTrackStore.ts` ← MIDI, Workspace
- `stores/markerStore.ts` ← CrdtDocument, Project, Workspace
- `stores/scratchPadStore.ts` ← Workspace
- `stores/takeLaneStore.ts` ← CrdtDocument, Project, Transport, Workspace
- `stores/timelineViewStore.ts` ← Command, Workspace
- `stores/trackStore.ts` ← AiGeneration, AiRuntime, AudioAnalysis, AudioEngine, Collaboration, Command, CrdtDocument, MIDI, Project, Toaster, Transport, Workspace
- `useCases/addTrack.ts` ← AiGeneration, AiRuntime, AudioAnalysis, Command, Plugin, Project, Workspace
- `useCases/audioAnalysis.ts` ← AiGeneration
- `useCases/automationQueries.ts` ← Automation, MIDI, Workspace
- `useCases/batchFeatureHandlers.ts` ← Command
- `useCases/clip/acceptGhostClip.ts` ← Workspace
- `useCases/clip/addClip.ts` ← AiGeneration, AiRuntime, AudioAnalysis, Toaster, Workspace
- `useCases/clip/dismissGhostClip.ts` ← Workspace
- `useCases/clip/duplicateClip.ts` ← Command
- `useCases/clip/duplicateClipToNextBar.ts` ← Command
- `useCases/clip/removeClip.ts` ← Workspace
- `useCases/clipEditing/createAlternativeClips.ts` ← AiGeneration
- `useCases/clipEditing/normalizeClip.ts` ← Workspace
- `useCases/clipEditing/renameClip.ts` ← Command, Workspace
- `useCases/clipEditing/reverseClip.ts` ← Workspace
- `useCases/clipEditing/setClipColor.ts` ← Workspace
- `useCases/clipEditing/setClipFade.ts` ← Workspace
- `useCases/clipEditing/setClipFollowAction.ts` ← Workspace
- `useCases/clipEditing/setClipGain.ts` ← Workspace
- `useCases/clipEditing/splitClip.ts` ← Command
- `useCases/clipEditing/trimClipEnd.ts` ← Workspace
- `useCases/clipEditing/trimClipStart.ts` ← Workspace
- `useCases/clipGainEnvelope/addGainEnvelopePoint.ts` ← Workspace
- `useCases/clipGainEnvelope/getClipGainEnvelope.ts` ← Workspace
- `useCases/clipGainEnvelope/getGainAtBeat.ts` ← Transport
- `useCases/clipGainEnvelope/removeGainEnvelopePoint.ts` ← Workspace
- `useCases/clipGainEnvelope/resetClipGainEnvelope.ts` ← Workspace
- `useCases/clipGainEnvelope/toggleClipGainEnvelope.ts` ← Workspace
- `useCases/clipHandlers.ts` ← Command
- `useCases/clipboard/copySelectedClip.ts` ← Command, Workspace
- `useCases/clipboard/copySelectedNotes.ts` ← Workspace
- `useCases/clipboard/cutSelectedClip.ts` ← Command, Workspace
- `useCases/clipboard/pasteClip.ts` ← Command, Workspace
- `useCases/clipboard/pasteNotes.ts` ← Workspace
- `useCases/comping/addTake.ts` ← Transport
- `useCases/comping/addTakeLane.ts` ← Transport
- `useCases/comping/flattenComp.ts` ← Workspace
- `useCases/comping/selectTake.ts` ← Workspace
- `useCases/comping/setCompRegion.ts` ← Workspace
- `useCases/createTrack.ts` ← GrandBoule, MIDI, Project, Toaster
- `useCases/device/addDevice.ts` ← AiRuntime, Project, Workspace
- `useCases/device/addExternalDevice.ts` ← Plugin, Workspace
- `useCases/device/bypassDevice.ts` ← Workspace
- `useCases/device/removeDevice.ts` ← Workspace
- `useCases/device/reorderDevices.ts` ← Workspace
- `useCases/device/sendManagement.ts` ← AiRuntime, Workspace
- `useCases/device/setDeviceParameter.ts` ← Bacteria, Crust, Fermenter, Gluten, Grinder, Levain, MIDI, Proof, Workspace
- `useCases/deviceHandlers.ts` ← Command
- `useCases/duplicateTrack.ts` ← Command
- `useCases/freezeBounce/freezeTrack.ts` ← Workspace
- `useCases/getAllTracks.ts` ← AiGeneration, AudioAnalysis, Automation, Bacteria, Crust, Fermenter, Gluten, GrandBoule, Grinder, Levain, MIDI, ProofChamber, Toaster, Workspace
- `useCases/getBuiltinPlugins.ts` ← Workspace
- `useCases/getNextClipId.ts` ← MIDI
- `useCases/getPlatformPlugins.ts` ← Workspace
- `useCases/getPluginById.ts` ← Workspace
- `useCases/getTrackById.ts` ← AudioEngine, Automation, Synth
- `useCases/getTrackStoreState.ts` ← AiGeneration, AiRuntime, AudioAnalysis, AudioEngine, Command, GrandBoule, MIDI, Toaster, Transport, Workspace
- `useCases/importAudioFile.ts` ← Workspace
- `useCases/isDeviceSupportedOnCurrentPlatform.ts` ← AudioEngine
- `useCases/marker/markerOperations.ts` ← Command, Workspace
- `useCases/marker/sectionOperations.ts` ← Workspace
- `useCases/mixerSnapshot/operations.ts` ← Workspace
- `useCases/newFeatureHandlers.ts` ← Command
- `useCases/preset/presetLoading.ts` ← Workspace
- `useCases/preset/presetStorage.ts` ← Workspace
- `useCases/presetHandlers.ts` ← Command
- `useCases/recording.ts` ← Transport, Workspace
- `useCases/removeTrack.ts` ← AiRuntime, Command, Workspace
- `useCases/renameTrack.ts` ← AiRuntime, Workspace
- `useCases/replaceClipAudioBuffer.ts` ← Workspace
- `useCases/resolveComping.ts` ← AudioEngine, Transport
- `useCases/restoreHandlers.ts` ← Command
- `useCases/scratchPad/captureCommit.ts` ← Workspace
- `useCases/scratchPad/scratchPadCrud.ts` ← Workspace
- `useCases/setTrackGainPan.ts` ← AiRuntime, MIDI, Workspace
- `useCases/setTrackState.ts` ← MIDI, Workspace
- `useCases/setTrackStoreState.ts` ← Command, GrandBoule, Toaster
- `useCases/songStructureDetection.ts` ← Project
- `useCases/soundPresetLibrary.ts` ← Project, Workspace
- `useCases/stretchHandlers.ts` ← Command
- `useCases/stripSilence.ts` ← AiGeneration
- `useCases/timelineQueries.ts` ← Command
- `useCases/toggleTrackState/clearSolos.ts` ← Command
- `useCases/toggleTrackState/groupTracks.ts` ← AiRuntime
- `useCases/toggleTrackState/muteTrack.ts` ← Workspace
- `useCases/toggleTrackState/selectTrack.ts` ← Workspace
- `useCases/toggleTrackState/setAutomationMode.ts` ← Workspace
- `useCases/toggleTrackState/setTrackOutput.ts` ← Workspace
- `useCases/toggleTrackState/soloTrack.ts` ← Workspace
- `useCases/toggleTrackState/soloTrackExclusive.ts` ← Workspace
- `useCases/toggleTrackState/toggleChordTrackFollow.ts` ← Workspace
- `useCases/toggleTrackState/toggleInputMonitoring.ts` ← Workspace
- `useCases/toggleTrackState/toggleSoloSafe.ts` ← Workspace
- `useCases/trackHandlers.ts` ← Command
- `useCases/trackTemplate.ts` ← Command
- `useCases/trackViewActions.ts` ← Workspace
- `useCases/trackZoom.ts` ← Command
- `useCases/updateClip.ts` ← MIDI, Transport
- `useCases/updateTrack.ts` ← MIDI
- `useCases/vca/assignToVca.ts` ← Command, Workspace
- `useCases/vca/createAndAssignVcaGroup.ts` ← Workspace
- `useCases/vca/createVcaGroup.ts` ← Command, Workspace
- `useCases/vca/getEffectiveGain.ts` ← Transport
- `useCases/vca/getVcaGroups.ts` ← Workspace
- `useCases/vca/removeFromVca.ts` ← Command, Workspace
- `useCases/vca/setVcaGain.ts` ← Command
- `useCases/vca/toggleVcaMembership.ts` ← Workspace
- `useCases/vcaFader.ts` ← Workspace
- `useCases/warp.ts` ← Workspace

---

### AudioAnalysis — 12 paths, 14 unique cross-module import relationships

Needs `index.ts` exporting:

- `useCases/analysisHandlers.ts` ← Command
- `useCases/audioAi.ts` ← AiGeneration
- `useCases/audioFeatures.ts` ← Arrangement, Workspace
- `useCases/audioToMidi.ts` ← Arrangement, Workspace
- `useCases/insertPolyphonicMidiNotes.ts` ← Workspace
- `useCases/keyDetection.ts` ← Arrangement
- `useCases/mixHealthAnalysis.ts` ← Workspace
- `useCases/pitchDetection.ts` ← Workspace
- `useCases/polyphonicAudioToMidi.ts` ← Workspace
- `useCases/referenceMixComparison/analyzeMix.ts` ← AiRuntime
- `useCases/referenceMixComparison/compareMixes.ts` ← Arrangement
- `useCases/tempoDetection.ts` ← Arrangement

---

### AudioEngine — 35 paths, 75 unique cross-module import relationships

**4 paths are `presentations/views/`** — promote via the owning module’s root `index.ts`.

Needs `index.ts` exporting:

- `presentations/views/AudioDevicePicker.tsx` ← Workspace `[view]`
- `presentations/views/MidiDevicePicker.tsx` ← Workspace `[view]`
- `presentations/views/PluginBrowser.tsx` ← Workspace `[view]`
- `presentations/views/PluginScanSettings.tsx` ← Workspace `[view]`
- `stores/audioBufferCache.ts` ← AiGeneration, Arrangement, AudioAnalysis, Collaboration, Project, Transport, Workspace
- `stores/audioGraphStore.ts` ← Workspace
- `stores/audioRecordingStore.ts` ← Workspace
- `stores/linkStatusStore.ts` ← Workspace
- `useCases/advancedMetering/lufs.ts` ← Workspace
- `useCases/advancedMetering/phaseCorrelation.ts` ← Workspace
- `useCases/audioDeviceSelection.ts` ← Arrangement
- `useCases/audioEngineQueries.ts` ← Routing, Synth, Transport
- `useCases/audioRecorder/startAudioRecording.ts` ← Transport
- `useCases/audioRecorder/startInputMonitoring.ts` ← Arrangement
- `useCases/audioRecorder/stopAudioRecording.ts` ← Transport
- `useCases/audioRecorder/stopInputMonitoring.ts` ← Arrangement
- `useCases/audition.ts` ← Workspace
- `useCases/buildDeviceChain.ts` ← Arrangement
- `useCases/controlRoom/switchMonitor.ts` ← Arrangement
- `useCases/controlRoom/toggleDim.ts` ← Arrangement
- `useCases/controlRoom/toggleMono.ts` ← Arrangement
- `useCases/decodeAudioFile.ts` ← Arrangement
- `useCases/deviceControls.ts` ← Arrangement, Bacteria, Crust, Fermenter, Gluten, GrandBoule, Grinder, Project, ProofChamber, Synth, Toaster, Transport
- `useCases/engineAccess.ts` ← Arrangement, AudioAnalysis, Collaboration, GrandBoule, Project, Proof, Routing, Toaster, Transport, Workspace, Yeast
- `useCases/finalFeatureHandlers.ts` ← Command
- `useCases/initializeAudioEngine.ts` ← Workspace
- `useCases/latencyCompensation/compensation.ts` ← Arrangement, Transport, Workspace
- `useCases/nativeAiBridge.ts` ← AiGeneration, Workspace
- `useCases/offlineRender.ts` ← Project
- `useCases/scheduling.ts` ← Synth, Transport
- `useCases/setMasterGain.ts` ← Transport
- `useCases/trackAudioControls.ts` ← Arrangement, AudioAnalysis, MIDI, Project, Transport, Workspace
- `useCases/triggerLiveNoteOff.ts` ← VirtualKeyboard
- `useCases/triggerLiveNoteOn.ts` ← VirtualKeyboard
- `useCases/webMidiInput.ts` ← Arrangement, Transport, Workspace

---

### Automation — 26 paths, 35 unique cross-module import relationships

Needs `index.ts` exporting:

- `stores/automationStore.ts` ← Arrangement, Command, CrdtDocument, Project, Transport, Workspace
- `useCases/automation/addAutomationLane.ts` ← Arrangement, Workspace
- `useCases/automation/addAutomationPoint.ts` ← Arrangement, Workspace
- `useCases/automation/batchAddAutomationPoints.ts` ← Arrangement
- `useCases/automation/createAutomationLane.ts` ← Project
- `useCases/automation/duplicateClipAutomation.ts` ← Arrangement
- `useCases/automation/getAutomationValueAtBeat.ts` ← Transport
- `useCases/automation/removeAutomationLane.ts` ← Workspace
- `useCases/automation/removeAutomationPoint.ts` ← Arrangement, Workspace
- `useCases/automation/setAutomationPointCurve.ts` ← Workspace
- `useCases/automation/shiftClipAutomation.ts` ← Arrangement
- `useCases/automation/toggleAutomationVisibility.ts` ← Workspace
- `useCases/automation/toggleLaneCollapsed.ts` ← Workspace
- `useCases/automation/updateAutomationPoint.ts` ← Workspace
- `useCases/automationDrawMode.ts` ← Workspace
- `useCases/automationHandlers.ts` ← Command
- `useCases/automationRecording/isRecordingAutomation.ts` ← Transport
- `useCases/automationRecording/recordAutomationValue.ts` ← Arrangement, MIDI
- `useCases/automationRecording/releaseTouchAutomation.ts` ← Workspace
- `useCases/automationRecording/startAutomationRecording.ts` ← Transport
- `useCases/automationRecording/stopAutomationRecording.ts` ← Transport
- `useCases/automationSelection.ts` ← Workspace
- `useCases/automationShapes.ts` ← Workspace
- `useCases/automationZoom.ts` ← Workspace
- `useCases/getAutomationLanes.ts` ← AudioEngine
- `useCases/getAutomationStoreState.ts` ← Workspace

---

### Bacteria — 2 paths, 2 unique cross-module import relationships

- `presentations/views/BacteriaPanel.tsx` ← Workspace `[view]`
- `stores/bacteriaStore.ts` ← AudioEngine

---

### Collaboration — 5 paths, 8 unique cross-module import relationships

- `presentations/views/CollaborationPanel.tsx` ← Workspace `[view]`
- `presentations/views/PresenceOverlay.tsx` ← Arrangement `[view]`
- `stores/collaborationStore.ts` ← Arrangement, Transport, Workspace
- `useCases/collaboration/sessionManagement.ts` ← Arrangement, Transport
- `useCases/collaborationHandlers.ts` ← Command

---

### Command — 16 paths, 35 unique cross-module import relationships

**3 paths are `presentations/views/`** — promote via the owning module’s root `index.ts`.

- `presentations/views/CommandPalette.tsx` ← Workspace `[view]`
- `presentations/views/UndoHistoryPanel.tsx` ← Workspace `[view]`
- `presentations/views/keyboardShortcutsContract.ts` ← Workspace `[view]`
- `stores/macroStore.ts` ← Workspace
- `stores/undoStore.ts` ← AiGeneration, AiRuntime, Arrangement, MIDI, Project, Workspace
- `useCases/actionLabels.ts` ← AiRuntime, Workspace
- `useCases/commandQueries.ts` ← AiGeneration, AiRuntime, Arrangement, MIDI, Workspace
- `useCases/executeAppAction.ts` ← AiRuntime, Arrangement, AudioAnalysis, CrdtDocument, Extension, Workspace
- `useCases/keyboardShortcutActions/trackShortcuts.ts` ← Workspace
- `useCases/keyboardShortcutActions/transportShortcuts.ts` ← Project, Workspace
- `useCases/macro/management.ts` ← Workspace
- `useCases/macro/playback.ts` ← Workspace
- `useCases/macro/recording.ts` ← Workspace
- `useCases/pushUndoEntry.ts` ← Arrangement, Automation, Workspace
- `useCases/trackAlternativeHandlers.ts` ← Workspace
- `useCases/undoRedo.ts` ← AiRuntime, Workspace

---

### CrdtDocument — 19 paths, 25 unique cross-module import relationships

**1 path is `presentations/views/`** — promote via the owning module’s root `index.ts`.

- `presentations/views/BranchManagerDialog.tsx` ← Workspace `[view]`
- `stores/actionHistoryStore.ts` ← AiRuntime, Command
- `stores/branchStore.ts` ← Collaboration
- `useCases/crdtDocumentTypes.ts` ← Project, Routing, Transport
- `useCases/crdtProjectLifecycle.ts` ← Collaboration, Project, Workspace
- `useCases/createCrdtDoc.ts` ← Collaboration
- `useCases/getCrdtDoc.ts` ← Collaboration
- `useCases/getCrdtDocIds.ts` ← Collaboration
- `useCases/hasCrdtDoc.ts` ← Collaboration
- `useCases/mutateCrdtDoc.ts` ← Collaboration
- `useCases/projection/projectProjection.ts` ← Collaboration, Project
- `useCases/removeCrdtDoc.ts` ← Collaboration
- `useCases/replaceCrdtDoc.ts` ← Collaboration
- `useCases/restoreSnapshot.ts` ← Command
- `useCases/revertAction.ts` ← AiRuntime
- `useCases/saveSnapshot.ts` ← AiRuntime
- `useCases/semanticChangeContext.ts` ← Command
- `useCases/startCrdtAutoSave.ts` ← Project
- `useCases/subscribeToCrdtChanges.ts` ← Collaboration

---

### Crust — 1 path

- `presentations/views/CrustPanel.tsx` ← Workspace `[view]`

---

### Fermenter — 3 paths, 3 unique cross-module import relationships

- `presentations/views/FermenterPanel.tsx` ← Workspace `[view]`
- `useCases/fermenterParamBridge.ts` ← MIDI
- `useCases/fermenterQueries.ts` ← Arrangement

---

### Gluten — 2 paths, 2 unique cross-module import relationships

- `presentations/views/GlutenPanel.tsx` ← Workspace `[view]`
- `stores/glutenStore.ts` ← AudioEngine

---

### GrandBoule — 2 paths, 2 unique cross-module import relationships

- `presentations/views/GrandBoulePanel.tsx` ← Workspace `[view]`
- `useCases/createGrandBouleTrack.ts` ← Workspace

---

### Grinder — 2 paths, 2 unique cross-module import relationships

- `presentations/views/GrinderPanel.tsx` ← Workspace `[view]`
- `stores/grinderStore.ts` ← AudioEngine

---

### Knead — 2 paths, 2 unique cross-module import relationships

- `stores/kneadStore.ts` ← Workspace
- `useCases/dspAnalysis.ts` ← Workspace

---

### Levain — 4 paths, 5 unique cross-module import relationships

- `presentations/views/LevainPanel.tsx` ← Workspace `[view]`
- `stores/levainStore.ts` ← Arrangement, AudioEngine
- `useCases/autoLoadSamples.ts` ← AudioEngine
- `useCases/levainParamBridge.ts` ← AudioEngine

---

### MIDI — 52 paths, 73 unique cross-module import relationships

Needs `index.ts` exporting:

- `stores/midiLearnStore.ts` ← Arrangement
- `stores/midiStore.ts` ← AiGeneration, AiRuntime, Arrangement, CrdtDocument, Project, Transport, Workspace
- `useCases/arpeggiator.ts` ← Arrangement
- `useCases/chordStamps.ts` ← Workspace
- `useCases/chordTrack/addChordEvent.ts` ← Workspace
- `useCases/chordTrack/clearChordTrack.ts` ← Workspace
- `useCases/chordTrack/getChordAtBeat.ts` ← Transport
- `useCases/chordTrack/moveChordEvent.ts` ← Workspace
- `useCases/chordTrack/removeChordEvent.ts` ← Workspace
- `useCases/chordTrack/toggleChordTrack.ts` ← Workspace
- `useCases/chordTrack/updateChordEvent.ts` ← Workspace
- `useCases/chordTrackHandlers.ts` ← Command
- `useCases/createMidiNote.ts` ← AiGeneration, Arrangement, AudioEngine
- `useCases/exportMidiFile.ts` ← Arrangement, Workspace
- `useCases/formatChordName.ts` ← Workspace
- `useCases/getMidiLearnState.ts` ← AudioEngine
- `useCases/getMidiStoreState.ts` ← AudioEngine
- `useCases/grooveExtraction.ts` ← Workspace
- `useCases/importMidiFile.ts` ← Arrangement, Workspace
- `useCases/midiEvent/addMidiCC.ts` ← Workspace
- `useCases/midiEvent/addPitchBend.ts` ← Workspace
- `useCases/midiEvent/moveMidiCC.ts` ← Workspace
- `useCases/midiEvent/movePitchBend.ts` ← Workspace
- `useCases/midiEvent/removeMidiCC.ts` ← Workspace
- `useCases/midiEvent/removePitchBend.ts` ← Workspace
- `useCases/midiEvent/setNotePressure.ts` ← Workspace
- `useCases/midiEvent/setNoteSlide.ts` ← Workspace
- `useCases/midiLearn.ts` ← Arrangement, AudioEngine
- `useCases/midiNoteCrud/addMidiNote.ts` ← AiGeneration, AiRuntime, Arrangement, AudioAnalysis, Toaster, Workspace
- `useCases/midiNoteCrud/batchAddMidiNotes.ts` ← AiGeneration, AudioAnalysis
- `useCases/midiNoteCrud/getNotesForClip.ts` ← AiGeneration, Workspace
- `useCases/midiNoteCrud/moveMidiNote.ts` ← Workspace
- `useCases/midiNoteCrud/removeMidiNote.ts` ← Workspace
- `useCases/midiNoteCrud/resizeMidiNote.ts` ← Workspace
- `useCases/midiNoteCrud/setNoteProbability.ts` ← Workspace
- `useCases/midiNoteCrud/setNoteVelocity.ts` ← Workspace
- `useCases/midiNoteCrud/setNotesForClip.ts` ← AiGeneration, Arrangement
- `useCases/midiNoteCrud/shiftClipMidiNotes.ts` ← Arrangement
- `useCases/midiNoteTransforms/humanizeNotes.ts` ← AiRuntime, Workspace
- `useCases/midiNoteTransforms/invertNotes.ts` ← Workspace
- `useCases/midiNoteTransforms/quantizeNoteLengths.ts` ← Workspace
- `useCases/midiNoteTransforms/quantizeNotes.ts` ← Workspace
- `useCases/midiNoteTransforms/retrogradeNotes.ts` ← Workspace
- `useCases/midiNoteTransforms/scaleAllVelocities.ts` ← Workspace
- `useCases/midiNoteTransforms/scaleVelocities.ts` ← Workspace
- `useCases/midiNoteTransforms/setAllVelocities.ts` ← Workspace
- `useCases/midiNoteTransforms/transposeNotes.ts` ← Workspace
- `useCases/midiRouting.ts` ← Command, Workspace
- `useCases/patternInstanceHandlers.ts` ← Command
- `useCases/setMidiStoreState.ts` ← AudioEngine
- `useCases/strumNotes.ts` ← Workspace
- `useCases/transposeForChordTrack.ts` ← Transport

---

### Plugin — 15 paths, 21 unique cross-module import relationships

- `stores/pluginScanStore.ts` ← AudioEngine, Workspace
- `useCases/faustEngine/builtinDSP.ts` ← AudioEngine, Workspace
- `useCases/faustEngine/compilerEngine.ts` ← Arrangement, AudioEngine, Synth
- `useCases/modulatorLibrary.ts` ← Workspace
- `useCases/nodeView/toggleNodeView.ts` ← AudioEngine
- `useCases/pluginBrowserActions.ts` ← AudioEngine
- `useCases/pluginHostHandlers.ts` ← Command
- `useCases/pluginLifecycle.ts` ← Arrangement, Workspace
- `useCases/pluginQueries.ts` ← Workspace
- `useCases/pluginScan/scanning.ts` ← AudioEngine
- `useCases/proModulationEffects.ts` ← Workspace
- `useCases/pushIntegration/connectPush.ts` ← AudioEngine
- `useCases/pushIntegration/disconnectPush.ts` ← AudioEngine
- `useCases/wamPluginHost/builtinDescriptors.ts` ← AudioEngine, Workspace
- `useCases/wamPluginHost/hostOperations.ts` ← AudioEngine

---

### Project — 14 paths, 19 unique cross-module import relationships

**3 paths are `presentations/views/`** — promote via the owning module’s root `index.ts`.

- `presentations/views/ArrangementSelector.tsx` ← Workspace `[view]`
- `presentations/views/ExportDialog.tsx` ← Workspace `[view]`
- `presentations/views/RecentProjectsMenu.tsx` ← Workspace `[view]`
- `stores/arrangementStore.ts` ← CrdtDocument
- `stores/projectStore.ts` ← CrdtDocument, Workspace
- `useCases/fileDialog.ts` ← Command, Workspace
- `useCases/projectPersistence/fileIO.ts` ← Command, Workspace
- `useCases/projectPersistence/helpers.ts` ← Workspace
- `useCases/projectPersistence/loadProject.ts` ← Workspace
- `useCases/projectPersistence/newProject.ts` ← Command, Workspace
- `useCases/projectPersistence/saveProject.ts` ← Command, Workspace
- `useCases/projectTemplates/templateDefinitions.ts` ← Workspace
- `useCases/songStructureHandlers.ts` ← Command
- `useCases/versionControlHandlers.ts` ← Command

---

### Proof — 3 paths, 3 unique cross-module import relationships

- `presentations/views/ProofPanel.tsx` ← Workspace `[view]`
- `stores/proofStore.ts` ← AudioEngine
- `useCases/proofParamBridge.ts` ← AudioEngine

---

### ProofChamber — 1 path

- `presentations/views/ProofChamberPanel.tsx` ← Workspace `[view]`

---

### Routing — 3 paths, 6 unique cross-module import relationships

- `useCases/busControls.ts` ← Arrangement, Transport
- `useCases/hydrateSidechainRoutes.ts` ← CrdtDocument
- `useCases/sidechain.ts` ← Arrangement, Project, Workspace

---

### SampleLibrary — 3 paths, 3 unique cross-module import relationships

- `presentations/views/LibraryBrowser.tsx` ← Workspace `[view]`
- `stores/libraryStore.ts` ← Arrangement
- `useCases/restoreLibrary.ts` ← Workspace

---

### Sampler — 1 path

- `presentations/views/SamplerPanel.tsx` ← Workspace `[view]`

---

### Scoring — 2 paths, 2 unique cross-module import relationships

- `presentations/views/ScoringPanel.tsx` ← Workspace `[view]`
- `stores/scoringStore.ts` ← AudioEngine

---

### SoundLibrary — 1 path

- `useCases/sampleDatabase/searchSamples.ts` ← Arrangement

---

### Synth — 6 paths, 10 unique cross-module import relationships

- `useCases/builtinSynth.ts` ← AudioEngine, Transport
- `useCases/cvGate/cvOutputOperations.ts` ← AudioEngine
- `useCases/drumKitSynth.ts` ← AudioEngine, Transport
- `useCases/drumSynthEngine/kitDefinitions.ts` ← AudioEngine, Transport
- `useCases/faustInstrumentScheduler.ts` ← AudioEngine, Transport
- `useCases/proSynthInstruments.ts` ← Workspace

---

### Toaster — 3 paths, 3 unique cross-module import relationships

- `presentations/views/ToasterPanel.tsx` ← Workspace `[view]`
- `useCases/createDrumTrackStack.ts` ← Workspace
- `useCases/toasterQueries.ts` ← Project

---

### Transport — 30 paths, 65 unique cross-module import relationships

Needs `index.ts` exporting:

- `stores/playheadPositionRef.ts` ← Arrangement, AudioEngine, Command, Toaster, Workspace
- `stores/tempoMapStore.ts` ← Arrangement, CrdtDocument, Project, Workspace
- `stores/timeSignatureMapStore.ts` ← Arrangement, CrdtDocument, Project
- `stores/transportStore.ts` ← AiRuntime, Arrangement, Collaboration, Command, CrdtDocument, Project, Toaster, Workspace, Yeast
- `useCases/ensureTrackStrips.ts` ← Project, Workspace
- `useCases/loopStation/toggleRecord.ts` ← Arrangement
- `useCases/loopStation/triggerScene.ts` ← Arrangement
- `useCases/punchRecording/togglePunchRecording.ts` ← Arrangement
- `useCases/setLooping.ts` ← AiRuntime, Arrangement
- `useCases/setMasterGain.ts` ← Workspace
- `useCases/setTempo.ts` ← Workspace
- `useCases/setTimeSignature.ts` ← Workspace
- `useCases/setlist/nextItem.ts` ← Arrangement
- `useCases/setlist/previousItem.ts` ← Arrangement
- `useCases/tempoMap.ts` ← Workspace
- `useCases/tempoMapping/operations.ts` ← Arrangement
- `useCases/transportControls/seekPlayhead.ts` ← Arrangement, Command
- `useCases/transportControls/setCountInBars.ts` ← Workspace
- `useCases/transportControls/setLoopRegion.ts` ← AiRuntime, Arrangement
- `useCases/transportControls/setMetronomeVolume.ts` ← Workspace
- `useCases/transportControls/stopPlayback.ts` ← Command, Workspace
- `useCases/transportControls/toggleCountIn.ts` ← Workspace
- `useCases/transportControls/toggleLoop.ts` ← Arrangement, Command, Workspace
- `useCases/transportControls/toggleMetronome.ts` ← Command, Workspace
- `useCases/transportControls/toggleOverdub.ts` ← Workspace
- `useCases/transportControls/togglePlayback.ts` ← Command, Workspace
- `useCases/transportControls/togglePunchEnabled.ts` ← Workspace
- `useCases/transportControls/toggleRecording.ts` ← Command, Workspace
- `useCases/transportHandlers.ts` ← Command
- `useCases/transportQueries.ts` ← AiGeneration, AiRuntime, Arrangement, AudioAnalysis, AudioEngine, Command, MIDI, Project, Workspace

---

### VirtualKeyboard — 1 path

- `presentations/views/VirtualKeyboard.tsx` ← Workspace `[view]`

---

### Workspace — 13 paths, 24 unique cross-module import relationships

- `stores/preferencesStore.ts` ← Arrangement
- `stores/workspaceStore.ts` ← AiGeneration, AiRuntime, Arrangement, Collaboration, Command, VirtualKeyboard
- `useCases/dialogs.ts` ← Project
- `useCases/rippleEditing.ts` ← Arrangement
- `useCases/scratchPadHandlers.ts` ← Command
- `useCases/setEditingTool.ts` ← Command
- `useCases/setTrackHeight.ts` ← Arrangement
- `useCases/setWorkspaceMode.ts` ← Arrangement
- `useCases/togglePanel/panelToggles.ts` ← AiRuntime, Arrangement, Collaboration, Command, VirtualKeyboard
- `useCases/togglePanel/zoomOperations.ts` ← Arrangement, Command
- `useCases/workspaceHandlers.ts` ← Command
- `useCases/workspaceQueries.ts` ← Arrangement, Command
- `useCases/workspaceState.ts` ← Command

---

### Yeast — 3 paths, 3 unique cross-module import relationships

- `presentations/views/YeastPanel.tsx` ← Workspace `[view]`
- `stores/yeastStore.ts` ← Transport
- `useCases/yeastSchedulingBridge.ts` ← AudioEngine

---

## 4. Summary Table

| Target Module    | Unique paths | Cross-module imports | `[view]` paths |
|------------------|-------------|----------------------|----------------|
| Arrangement      | 122         | 211                  | 8              |
| MIDI             | 52          | 73                   | 0              |
| AudioEngine      | 35          | 75                   | 4              |
| Transport        | 30          | 65                   | 0              |
| Automation       | 26          | 35                   | 0              |
| AiRuntime        | 22          | 26                   | 6              |
| CrdtDocument     | 19          | 25                   | 1              |
| AiGeneration     | 13          | 17                   | 0              |
| AudioAnalysis    | 12          | 14                   | 0              |
| Plugin           | 15          | 21                   | 0              |
| Command          | 16          | 35                   | 3              |
| Project          | 14          | 19                   | 3              |
| Workspace        | 13          | 24                   | 0              |
| Routing          | 3           | 6                    | 0              |
| Synth            | 6           | 10                   | 0              |
| Fermenter        | 3           | 3                    | 1              |
| Levain           | 4           | 5                    | 1              |
| SampleLibrary    | 3           | 3                    | 1              |
| Toaster          | 3           | 3                    | 1              |
| Collaboration    | 5           | 8                    | 2              |
| Yeast            | 3           | 3                    | 1              |
| Bacteria         | 2           | 2                    | 1              |
| GrandBoule       | 2           | 2                    | 1              |
| Gluten           | 2           | 2                    | 1              |
| Grinder          | 2           | 2                    | 1              |
| Knead            | 2           | 2                    | 0              |
| Proof            | 3           | 3                    | 1              |
| Scoring          | 2           | 2                    | 1              |
| Crust            | 1           | 1                    | 1              |
| ProofChamber     | 1           | 1                    | 1              |
| Sampler          | 1           | 1                    | 1              |
| SoundLibrary     | 1           | 1                    | 0              |
| VirtualKeyboard  | 1           | 1                    | 1              |
| **Total**        | **~468**    | **1 190**            | **~42**        |

**`[view]` paths** (42 total): add `presentations/views/` re-exports to the owning module’s root `index.ts`. Other paths (≈426): add module root `index.ts` re-exports from `useCases/`, `events/`, `stores/`, and `presentations/views/` where needed.
