# useSyncExternalStore → useStore Migration Audit

**Status:** ✅ COMPLETE  
**Started:** 2026-04-07  
**Completed:** 2026-04-07

---

## Summary

All eligible files have been migrated from `useSyncExternalStore` to the `useStore` hook. The `useStore` hook wraps `useSyncExternalStore` with a cleaner API that provides default values directly.

### Migration Pattern

```typescript
// Before
import { useSyncExternalStore } from 'react';
const trackState = useSyncExternalStore(
    (cb) => trackStore.subscribe(() => cb()),
    () => trackStore.value,
    () => trackStore.value
);

// After
import { useStore } from '#/infra/store/useStore';
const trackState = useStore<TrackStoreState>(trackStore, { tracks: [], selectedTrackId: null });
```

---

## Files Migrated (73 Total)

### Workspace Module (28 files)

| File | Stores Migrated |
|------|-----------------|
| `presentations/hooks/useTracks.ts` | trackStore |
| `presentations/hooks/useActiveTool.ts` | workspaceStore |
| `presentations/hooks/useLeftPanel.ts` | workspaceStore |
| `presentations/hooks/useRightPanel.ts` | workspaceStore |
| `presentations/hooks/useBottomPanel.ts` | workspaceStore |
| `presentations/hooks/useArrangeView.ts` | workspaceStore, timelineViewStore |
| `presentations/hooks/useArrangeSelection.ts` | workspaceStore |
| `presentations/hooks/useTrackSelection.ts` | trackStore |
| `presentations/hooks/useSelectionCount.ts` | workspaceStore |
| `presentations/hooks/useTransportDisplay.ts` | transportStore |
| `presentations/hooks/useProjectTitle.ts` | projectStore |
| `presentations/hooks/usePromptExecution.ts` | llmStatusStore, trackStore, workspaceStore |
| `presentations/views/TransportBar.tsx` | trackStore |
| `presentations/views/AppShell.tsx` | preferencesStore, aiStore |
| `presentations/views/ArrangeView.tsx` | workspaceStore, timelineViewStore, markerStore, chordTrackStore |
| `presentations/views/AutomationBottomPanel.tsx` | trackStore, automationStore, timelineViewStore, workspaceStore |
| `presentations/views/AutomationView.tsx` | timelineViewStore |
| `presentations/views/AutomationView/AutomationLaneRow.tsx` | workspaceStore, transportStore |
| `presentations/views/AutomationView/TrackAutomationSection.tsx` | automationStore |
| `presentations/views/AutomationLane/NotePropertyLane.tsx` | midiStore, trackStore |
| `presentations/views/AutomationLane/CCLane.tsx` | midiStore |
| `presentations/views/AutomationLane/PitchBendLane.tsx` | midiStore |
| `presentations/views/Transport/PanelToggles.tsx` | aiStore, linkStatusStore |
| `presentations/views/Transport/PlayheadDisplay.tsx` | transportStore |
| `presentations/views/Transport/AutoScrollToggle.tsx` | timelineViewStore |
| `presentations/views/Transport/VoiceButton.tsx` | voiceStatusStore |
| `presentations/views/StatusBar.tsx` | llmStatusStore |
| `presentations/views/ShortcutsSection.tsx` | shortcutStore |
| `presentations/views/RoutingGraph.tsx` | trackStore |
| `presentations/views/PreferencesDialog.tsx` | preferencesStore |
| `presentations/views/InspectorPanel.tsx` | workspaceStore |
| `presentations/views/Mixer/MasterChannelStrip.tsx` | transportStore |
| `presentations/views/Sidebar/MacrosPanel.tsx` | macroStore |
| `presentations/views/Timeline/ChordTrackLane.tsx` | chordTrackStore |
| `presentations/views/Timeline/ScratchPadView.tsx` | scratchPadStore |
| `presentations/views/ClipView.tsx` | workspaceStore |
| `presentations/views/ClipView/PianoRoll.tsx` | midiStore, trackStore |
| `presentations/views/ClipView/KneadEditor.tsx` | kneadStore |

### Workspace - Inspector (5 files)

| File | Stores Migrated |
|------|-----------------|
| `presentations/views/Inspector/TrackDevicesSection.tsx` | pluginScanStore |
| `presentations/views/Inspector/TrackRoutingSection.tsx` | audioGraphStore |
| `presentations/views/Inspector/TrackAutomationSection.tsx` | automationStore |
| `presentations/views/Inspector/DeviceParameterControl.tsx` | automationStore |
| `presentations/views/Inspector/TakesSection.tsx` | takeLaneStore |

### Arrangement Module (7 files)

| File | Stores Migrated |
|------|-----------------|
| `presentations/views/ArrangementBar.tsx` | markerStore |
| `presentations/views/TrackListView.tsx` | preferencesStore, timelineViewStore |
| `presentations/views/TimelineMinimap.tsx` | trackStore, timelineViewStore |
| `presentations/views/BeatRulerBar.tsx` | timelineViewStore, transportStore |
| `presentations/views/MarkerLane.tsx` | markerStore |
| `presentations/views/MidiLearnButton.tsx` | midiLearnStore |
| `presentations/views/TrackHeader/LevainLoadingSpinner.tsx` | levainStore |

### AudioEngine Module (4 files)

| File | Stores Migrated |
|------|-----------------|
| `presentations/views/PluginBrowser.tsx` | pluginScanStore |
| `presentations/views/PluginScanSettings.tsx` | pluginScanStore |
| `presentations/views/MidiDevicePicker.tsx` | webMidiStore |
| `presentations/views/AudioDevicePicker.tsx` | audioDeviceStore |

### Command Module (2 files)

| File | Stores Migrated |
|------|-----------------|
| `presentations/views/UndoHistoryPanel.tsx` | undoStore |
| `presentations/views/CommandPalette.tsx` | shortcutStore |

### AI Runtime Module (5 files)

| File | Stores Migrated |
|------|-----------------|
| `presentations/views/ChatPanel.tsx` | chatStore |
| `presentations/views/GenerativeAiPanel.tsx` | aiStore, llmStatusStore |
| `presentations/views/AiActionHistoryPanel.tsx` | aiActionStore |
| `presentations/views/MixAnalysisPanel.tsx` | mixAnalysisStore |

### Collaboration Module (1 file)

| File | Stores Migrated |
|------|-----------------|
| `presentations/hooks/useCollaborationState.ts` | collaborationStore |

### Module Panels (18 files)

| File | Stores Migrated |
|------|-----------------|
| `GrandBoule/presentations/views/GrandBoulePanel.tsx` | grandBouleStore |
| `Toaster/presentations/views/ToasterPanel.tsx` | toasterStore, trackStore |
| `Sampler/presentations/views/SamplerPanel.tsx` | samplerStore, padStore, sliceStore |
| `Proof/presentations/views/ProofPanel.tsx` | proofStore |
| `Project/presentations/views/ArrangementSelector.tsx` | arrangementStore |
| `Grinder/presentations/views/GrinderPanel.tsx` | grinderStore |
| `Crust/presentations/views/CrustPanel.tsx` | crustStore |
| `Scoring/presentations/views/ScoringPanel.tsx` | scoringStore |
| `Bacteria/presentations/views/BacteriaPanel.tsx` | bacteriaStore |
| `Levain/presentations/views/LevainPanel.tsx` | levainStore |
| `Fermenter/presentations/views/FermenterPanel.tsx` | fermenterStore |
| `Gluten/presentations/views/GlutenPanel.tsx` | glutenStore |
| `Yeast/presentations/views/YeastPanel.tsx` | yeastStore |
| `VirtualKeyboard/presentations/views/VirtualKeyboard.tsx` | workspaceStore |
| `Plugin/ProofChamber/presentations/views/ProofChamber.tsx` | chamberStore |
| `SampleLibrary/presentations/views/LibraryBrowser.tsx` | libraryStore |
| `CrdtDocument/presentations/views/BranchManagerDialog.tsx` | branchStore |
| `Collaboration/presentations/views/CollaborationPanel.tsx` | workspaceStore |

---

## Files Intentionally NOT Migrated

These files correctly continue to use `useSyncExternalStore`:

| File | Reason |
|------|--------|
| `Workspace/presentations/hooks/useSelectionLabel.ts` | Multi-store hook combining workspaceStore + trackStore with custom subscribe |
| `Workspace/presentations/hooks/usePianoRollRenderer.ts` | Reads store values directly via `.value` in rAF loop (no hook usage) |

---

## Verification

```bash
$ pnpm typecheck
# No errors
```

---

## Common Store Default Values

For reference, here are the default values used for common stores:

| Store | Default Value |
|-------|--------------|
| `trackStore` | `{ tracks: [], selectedTrackId: null }` |
| `workspaceStore` | `defaultWorkspaceState` (imported from model) |
| `timelineViewStore` | `{ scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true }` |
| `transportStore` | `defaultTransportState` (imported from useCases/transportQueries) |
| `automationStore` | `{ lanes: [] }` |
| `markerStore` | `{ markers: [], sections: [] }` |
| `chordTrackStore` | `{ chords: [], rootNote: 60, scaleType: 'major' }` |
| `midiStore` | `{ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} }` |
| `preferencesStore` | `defaultPreferences` (imported from model) |

---

## Plugin Color System Update (Completed)

To ensure distinct visual identities for each plugin, the following color changes were made:

| Plugin | Old Primary | New Primary | Reason |
|--------|-------------|-------------|--------|
| Fermenter | Amber `#c4aa5f` | Yellow-Green `#8a9450` | Distinguish from Grinder orange |
| Scoring | Sage `#8aa88a` | Steel `#6a8aa8` | Distinguish from Fermenter secondary |

### Color Token Added
- `--color-accent-yellow-green: #8a9450` in `src/styles/tokens.css`

### Look & Feel Spec Created
- Full specification at `.agents/specs/ui/look-and-feel.md`
- Documents color wheel distribution (30° minimum separation)
- Includes plugin browser card styling
- Provides templates for new plugins
