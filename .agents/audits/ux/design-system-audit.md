# UX Design System Audit

## Purpose

This audit reviews presentation-layer code across `src/components` and `src/modules` to identify:

1. UI that is still styling itself inline even though it should now be using the shared DAW design system.
2. Repeated presentation patterns that show up often enough that they should be promoted into the design system.

The goal is not to eliminate every inline style. Geometry-driven values such as dynamic `width`, `height`, `left`, `top`, waveform sizes, and data-driven fill percentages are still appropriate inline. The focus here is on repeated material, chrome, and interaction styling that should be centralized.

The findings below are aligned with `.agents/specs/look-and-feel.md`:

- subtle surface hierarchy
- tactile but understated chrome
- consistent top-left lighting model
- vector-first DAW polish
- fewer one-off gradients and more reusable surface primitives

---

## Summary

The codebase has improved a lot, especially in plugin shells, shared `src/components/ui` primitives, and the first dedicated DAW-shell primitive pass. The work is no longer in a purely “audit-only” state: a meaningful neutral-shell consolidation has already landed. The biggest remaining gaps are now narrower and more internal than they were in the first sweep.

At this point, the highest-value unresolved areas are:

1. **Compact readout and meter rows are still duplicated inline** across status, analysis, mixer, and other utility readouts.
2. **Factory-plugin shell patterns are still repeated locally** instead of being promoted into reusable plugin-shell primitives.
3. **Several controls are still hand-rolled with raw HTML or hardcoded local styling** where they should use shared components or a thin themed wrapper.

This audit was expanded beyond the plugin suite and now covers recurring patterns across:

- `src/components/*`
- `src/modules/*/presentations/views/*`
- `src/modules/*/presentations/components/*`
- arrangement, workspace, inspector, transport, AI, project, collaboration, virtual keyboard, sample browser, and the factory plugin panels

At the time of the exhaustive presentation sweep:

- about `26` shared component files exist under `src/components`
- roughly `249` presentation view/component/contract files were considered across `src/modules/*/presentations`
- about `9` files define local plugin-shell card helpers like `MetricTile`, `SectionCard`, `SideCard`, or `ControlCard`
- about `5` presentation files still use raw `input[type="range"]`
- multiple presentation files still expose tiny uppercase labels, compact chips, status dots, and readout treatments directly as literal class strings
- empty, blocked, and selection-required states are much more centralized than they were at the start of the audit, but a few local variants still remain

---

## Implementation Status Update

The following shared primitives and utilities now exist and are live adopters, so the audit should treat those families as partially addressed rather than hypothetical:

- neutral DAW shell primitives:
  - `src/components/daw/DawHeaderBand.tsx`
  - `src/components/daw/DawControlStrip.tsx`
  - `src/components/daw/DawEmptyState.tsx`
  - `src/components/daw/DawAnalysisCard.tsx`
  - `src/components/daw/DawDisplaySurface.tsx`
  - `src/components/daw/DawChannelStripShell.tsx`
  - `src/components/daw/DawSideRail.tsx`
  - `src/components/daw/DawGridHeaderCell.tsx`
  - `src/components/daw/DawUtilityPanel.tsx`
- small repeated presentation primitives:
  - `src/components/daw/DawCompactSelect.tsx`
  - `src/components/daw/DawInlineHint.tsx`
  - `src/components/daw/DawMicroBadge.tsx`
  - `src/components/daw/DawSectionDivider.tsx`
  - `src/components/daw/DawStatusDot.tsx`
  - `src/components/daw/DawMeterBar.tsx`
  - `src/components/daw/DawReadoutRow.tsx`
  - `src/components/daw/DawMiniSectionHeader.tsx`
- shared utility/material recipes in `src/styles/main.css`:
  - `daw-header-band`
  - `daw-floating-surface`
  - `daw-readout-well`
  - `daw-side-rail`
  - `daw-grid-header-cell`
- sidebar-local shared presentation helpers:
  - `src/modules/Workspace/presentations/components/Sidebar/SearchSummary.tsx`
- inspector-local shared presentation helpers:
  - `src/modules/Workspace/presentations/components/Inspector/ChoiceCard.tsx`
  - `src/modules/Workspace/presentations/components/Inspector/ControlHeader.tsx`
  - `src/modules/Workspace/presentations/components/Inspector/InsetPanel.tsx`
  - `src/modules/Workspace/presentations/components/Inspector/MetaText.tsx`
  - `src/modules/Workspace/presentations/components/Inspector/SurfaceCard.tsx`
- workspace-local floating-menu helpers:
  - `src/modules/Workspace/presentations/components/FloatingMenuParts.tsx`
- a local shared automation family:
  - `src/modules/Workspace/presentations/views/AutomationView/AutomationControls.tsx`

These already have real adoption across shell, transport, sidebar, prompt, automation, inspector, mixer, collaboration, command, and arrangement views, including but not limited to:

- `src/modules/Workspace/presentations/views/PreferencesDialog.tsx`
- `src/modules/Workspace/presentations/views/SessionView.tsx`
- `src/modules/Workspace/presentations/views/PromptBar.tsx`
- `src/modules/Workspace/presentations/views/Prompt/LlmStatusBadge.tsx`
- `src/modules/Workspace/presentations/views/StatusBar.tsx`
- `src/modules/Workspace/presentations/views/Transport/ProjectName.tsx`
- `src/modules/Workspace/presentations/views/TempoEditor.tsx`
- `src/modules/Workspace/presentations/views/ClipView/PianoRollToolbar.tsx`
- `src/modules/Workspace/presentations/views/ClipView/AutomationLane.tsx`
- `src/modules/Workspace/presentations/views/Mixer/ExpandedChannelStrip.tsx`
- `src/modules/Workspace/presentations/views/Mixer/DeviceChainSection.tsx`
- `src/modules/Workspace/presentations/views/Mixer/SendsSection.tsx`
- `src/modules/Workspace/presentations/views/Mixer/IOSection.tsx`
- `src/modules/Workspace/presentations/views/Mixer/IOSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackLatencySection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackLevelSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackRoutingSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/ClipInspector.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackMidiOutputSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackVcaSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/DeviceParameterControl.tsx`
- `src/modules/Workspace/presentations/views/Metering/LUFSMeter.tsx`
- `src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx`
- `src/modules/Workspace/presentations/views/AutomationView/TrackAutomationSection.tsx`
- `src/modules/Workspace/presentations/views/AutomationView/AutomationLaneHeader.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/ColorTab.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/StageTab.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/InstrumentsTab.tsx`
- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx`
- `src/modules/Arrangement/presentations/views/TrackHeader/InputSelector.tsx`
- `src/modules/Arrangement/presentations/views/TrackListView.tsx`
- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx`
- `src/modules/Command/presentations/views/CommandPalette.tsx`
- `src/modules/Command/presentations/views/UndoHistoryPanel.tsx`
- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx`
- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx`
- `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx`
- `src/modules/AiRuntime/presentations/views/PatternBrowser.tsx`
- `src/modules/AiRuntime/presentations/components/mixAnalysis/MixAnalysisSections.tsx`

Because of that, several earlier findings are now only partially open:

- repeated DAW header and shell chrome: substantially addressed, but not complete
- floating menu/context surfaces: substantially addressed for DAW-facing menus, but not fully eliminated repo-wide
- empty/blocked states: partially addressed through `DawEmptyState` and sidebar-local empty-state reuse
- transport/readout wells: partially addressed through `daw-readout-well` and related adopters
- compact DAW select controls: partially addressed through `DawCompactSelect`
- tiny micro-label / chip / status-dot families: partially addressed through `DawMicroBadge`, `DawSectionDivider`, `DawStatusDot`, and `SearchSummary`

The highest-priority unresolved areas after this implementation pass are now:

1. compact inline meter/readout rows and status-meter treatments
2. analysis and metering micro-surfaces
3. remaining mixer/internal strip-side repeated readouts and labels
4. plugin-shell cards, metric tiles, and themed chip families that still live locally
5. remaining raw slider/drawbar families

---

## Continuation Pass Update

The earlier audit directions still hold, but a fresh sweep makes three things more concrete:

1. **Transport duplication is broader than the transport folder alone.**
   The shared “micro shell + readout + divider” grammar now clearly spans:
    - `src/modules/Workspace/presentations/views/Transport/TransportControls.tsx:60`
    - `src/modules/Workspace/presentations/views/Transport/PanelToggles.tsx:64`
    - `src/modules/Workspace/presentations/views/Transport/UndoRedoButtons.tsx:17`
    - `src/modules/Workspace/presentations/views/Transport/SoloModeSelector.tsx:34`
    - `src/modules/Workspace/presentations/views/Transport/ProjectName.tsx:63`
    - `src/modules/Workspace/presentations/views/TempoEditor.tsx:17`
    - `src/modules/Workspace/presentations/views/ToolSelector.tsx:32`
    - `src/modules/Project/presentations/views/ArrangementSelector.tsx:99`

2. **Empty and blocked states are a more urgent cross-module family than the original summary made explicit.**
   Clear repeated examples now include:
    - `src/modules/AudioEngine/presentations/views/PluginBrowser.tsx:48`
    - `src/modules/AudioEngine/presentations/views/PluginScanSettings.tsx:35`
    - `src/modules/SampleLibrary/presentations/views/LibraryBrowser.tsx:175`
    - `src/modules/Collaboration/presentations/views/NearbyPanel.tsx:63`
    - `src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx:169`
    - `src/modules/Workspace/presentations/views/MixerPanel.tsx:219`
    - `src/modules/Workspace/presentations/views/AutomationLane/CCLane.tsx:129`
    - `src/modules/Workspace/presentations/views/AutomationLane/PitchBendLane.tsx:130`
    - `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx:171`

3. **The plugin-shell helper island is still concentrated in nine files, but the visual grammar around those helpers has spread farther.**
   Even where modules no longer define local helper components, they still recreate the same small-label, metric, and quick-read grammar directly:
    - `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:203`
    - `src/modules/Crust/presentations/views/CrustPanel.tsx:52`
    - `src/modules/Fermenter/presentations/views/FermenterPanel.tsx:114`

This keeps the implementation order unchanged:

- DAW header, cluster, and readout primitives still come first
- empty-state and blocked-state primitives are the next highest-leverage neutral family
- plugin section, metric, and micro-typography primitives remain the highest-value themed family

### Coverage Notes From The Ongoing Sweep

The exhaustive pass has now explicitly reopened and reviewed:

- shared `src/components/daw/*`, `src/components/daw/visualizers/*`, and `src/components/ui/*`
- AI runtime, arrangement, audio engine, collaboration, command, CRDT dialog, project, sample library, scoring, and virtual keyboard presentations
- the newer flagship plugin shells and supporting components for `Gluten`, `Toaster`, `Crust`, `Levain`, `Proof`, `ProofChamber`, and `Yeast`
- the remaining plugin islands for `Fermenter`, `Bacteria`, and `Grinder`
- the `Workspace` presentation component layer plus the shell-facing `AnalysisPanel`, `AppShell`, `InspectorPanel`, and `MixerPanel`

The same pass now also explicitly closed the remaining `Workspace` editor and shell families:

- automation, clip view, inspector internals, metering internals, mixer internals, sidebar tabs, transport subcomponents, routing/timeline helpers, and shell dialogs
- presentation-side outliers that were easy to miss from the earlier Workspace-only remainder count:
    - `src/modules/Command/presentations/views/keyboardShortcutsContract.ts`
    - `src/modules/AiRuntime/presentations/components/GenerativeParamGrids.tsx`
    - `src/modules/AiRuntime/presentations/components/mixAnalysis/MixAnalysisSections.tsx`
    - `src/modules/Arrangement/presentations/views/TimelineContextMenus.tsx`

Coverage is now exhaustive for the current on-disk target inventory under:

- `src/components/daw/*`
- `src/components/daw/visualizers/*`
- `src/components/ui/*`
- `src/modules/*/presentations/views/*`
- `src/modules/*/presentations/components/*`

That current inventory is `275` files total:

- `26` shared component files under `src/components`
- `249` module presentation files under `src/modules/*/presentations`

No remaining presentation view/component families are intentionally left outside this pass.

### Newly Confirmed Repeated Families

4. **Rack rows with inline expand/collapse and bypass badges form a real family.**
   This is no longer just a Yeast one-off. The same “compact module row + live/bypass badge + expander” grammar is now clearly recurring in:
    - `src/modules/Yeast/presentations/views/YeastPanel.tsx:404`
    - `src/modules/Yeast/presentations/views/YeastPanel.tsx:533`
    - `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx`
    - `src/modules/Workspace/presentations/views/Mixer/DeviceChainSection.tsx`

5. **Hero visualizer + control deck sections are a full plugin family, not isolated local taste.**
   The same layout shows up repeatedly:
    - a large canvas or diagram first
    - a compact row or grid of knobs below
    - a small header rail with chips or mode buttons

    Clear examples now include:
    - `src/modules/Fermenter/presentations/components/EnvelopeSection.tsx:39`
    - `src/modules/Fermenter/presentations/components/FilterSection.tsx:30`
    - `src/modules/Fermenter/presentations/components/LfoSection.tsx:58`
    - `src/modules/Levain/presentations/components/ExpressionPanel.tsx:108`
    - `src/modules/Levain/presentations/components/LegatoTuning.tsx:106`
    - `src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx:291`
    - `src/modules/Gluten/presentations/views/GlutenPanel.tsx:430`

6. **“Quick read” and “status tile” sidecards are repeated enough to deserve a neutral primitive pair.**
   The DAW should stay quieter than the plugins, but the pattern is stable:
    - small uppercase eyebrow
    - 2–5 compact metric tiles
    - a low-contrast diagnostic list in a side rail

    Confirmed again in:
    - `src/modules/Gluten/presentations/views/GlutenPanel.tsx:536`
    - `src/modules/Levain/presentations/views/LevainPanel.tsx:318`
    - `src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx:333`
    - `src/modules/Proof/presentations/views/ProofPanel.tsx:293`
    - `src/modules/Scoring/presentations/views/ScoringPanel.tsx:143`
    - `src/modules/Toaster/presentations/views/ToasterPanel.tsx:286`

7. **Keyboard/split and step-grid editors are recurring enough to track as their own primitive families.**
   These should not collapse into generic cards, but the chrome, labels, and interaction affordances repeat:
    - `src/modules/Yeast/presentations/components/KeyboardSplit.tsx:22`
    - `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:344`
    - `src/modules/Toaster/presentations/components/StepSequencer.tsx:21`
    - `src/modules/Yeast/presentations/components/StepPatternEditor.tsx:22`

8. **Launch, loading, notification, and lightweight utility overlays form a real shell-side family.**
   These are not dialogs and not menus, but they keep repeating the same understated overlay grammar:
    - branded or task-specific title block
    - restrained ambient glow or gradient wash
    - compact status copy or action row
    - fixed-position or full-screen shell treatment

    Confirmed in:
    - `src/modules/Workspace/presentations/components/LaunchScreen.tsx`
    - `src/modules/Workspace/presentations/components/ProjectLoadingOverlay.tsx`
    - `src/modules/Workspace/presentations/components/NotificationToast.tsx`
    - `src/modules/AiRuntime/presentations/views/VoiceCommandOverlay.tsx`
    - `src/modules/Collaboration/presentations/views/PresenceOverlay.tsx`

9. **Measured analysis cards and compact analysis-gallery wrappers are also recurring enough to deserve a neutral family.**
   The visualizer internals should stay local, but the surrounding chrome is repeating:
    - a compact header band
    - an inset measurement well
    - a shallow, bottom-panel-friendly card height
    - optional measured canvas host behavior

    Confirmed in:
    - `src/modules/Workspace/presentations/views/AnalysisPanel.tsx`
    - `src/modules/Workspace/presentations/components/MiniMasterSpectrum.tsx`
    - `src/modules/Workspace/presentations/views/Metering/Goniometer.tsx`
    - `src/modules/Workspace/presentations/views/Metering/Oscilloscope.tsx`
    - `src/modules/Workspace/presentations/views/Metering/SpectrumAnalyzer.tsx`

10. **Editor control rails and lane toolstrips are now clearly a cross-editor family.**
    The same compact-height grammar appears across MIDI, audio, automation, and timeline tools:
    - dense top control strip with micro labels
    - lane or mode selector tucked into the same rail
    - bottom-panel-friendly height with immediate controls over descriptive copy
    - repeated divider seams and quiet segmented groups

    Confirmed in:
    - `src/modules/Workspace/presentations/views/ClipView.tsx`
    - `src/modules/Workspace/presentations/views/ClipView/PianoRollToolbar.tsx`
    - `src/modules/Workspace/presentations/views/ClipView/WaveformEditor.tsx`
    - `src/modules/Workspace/presentations/views/ClipView/AutomationLane.tsx`
    - `src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx`
    - `src/modules/Workspace/presentations/views/Timeline/ChordTrackLane.tsx`
    - `src/modules/Workspace/presentations/views/Timeline/ScratchPadView.tsx`
    - `src/modules/Workspace/presentations/views/SessionView.tsx`

11. **Inspector assignment cards and chooser rows are a real neutral family, not just section-local markup.**
   Status: partially addressed by the inspector-local `ChoiceCard`, `SurfaceCard`, and `MetaText` helpers now used in `TrackDevicesSection`, `TrackClipsSection`, `TrackAlternativesSection`, `TakesSection`, `TrackRoutingSection`, `TrackMidiOutputSection`, `TrackVcaSection`, `TrackAutomationSection`, and adjacent inspector cards, but the broader chooser-row/assignment family still spans additional inspector and routing/send surfaces.
    The same pattern repeats across track management, routing, takes, alternatives, sends, clips, and MIDI destinations:
    - compact section header with a minimal action button
    - one- or two-column cards for the current assignment set
    - inline toggles, remove actions, or chooser controls inside each card
    - understated neutral chrome rather than plugin-style flair

    Confirmed in:
    - `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/TrackClipsSection.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/TrackAutomationSection.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/SendsEditor.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/TrackAlternativesSection.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/TakesSection.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/TrackMidiOutputSection.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/TrackVcaSection.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/TrackRoutingSection.tsx`

12. **Device-layout param decks have stabilized into their own inspector-side family.**
    The registry-backed layouts are different per device, but their framing is now obviously repeated:
    - section header
    - one hero visualizer or identity band
    - repeated two-up parameter cards
    - optional collapsible advanced groups

    Confirmed in:
    - `src/modules/Workspace/presentations/views/Inspector/GenericDeviceLayout.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/layouts/BuiltinSynthLayout.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/layouts/FaustInstrumentLayout.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/layouts/NativeEffectLayouts.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/layouts/EQLayout.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/layouts/CompressorLayout.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/layouts/DelayLayout.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/layouts/ReverbLayout.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/layouts/ChorusLayout.tsx`
    - `src/modules/Workspace/presentations/views/Inspector/layouts/DistortionLayout.tsx`

This slightly sharpens the priority order:

- DAW chrome, empty states, and command/picker surfaces remain first
- rack rows / device rows are now a clear neutral-family follow-up
- utility overlays and metering-gallery wrappers should join the neutral-family track
- inspector assignment cards and device-layout param decks now belong on the neutral-family track as well
- plugin hero-section shells, status tiles, and editor chrome are the next themed-family promotion candidates

---

## What Should Stay Inline

These are not design-system problems and should remain local:

- Canvas sizing and retina scaling in visualizers such as `src/components/daw/visualizers/*`
- Dynamic positioning like `left`, `top`, `width`, `height` for notes, clips, markers, mic dots, playheads, and piano keys
- Data-driven fill widths and percentages for meters and bars
- Truly module-specific color values that come from user data, presets, or track/pad color models

The audit below only calls out inline styling when it is really repeating visual language that should be shared.

---

## Findings

### 1. Repeated DAW toolbar/header chrome should become shared utilities or wrappers

Status: partially addressed by `DawHeaderBand`, `DawControlStrip`, and the shared DAW shell utilities in `src/styles/main.css`, but a few view-local variants still remain.

The same “dark metal header strip” styling is repeated across many non-plugin views:

- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:280`
- `src/modules/Arrangement/presentations/views/TrackListView.tsx:168`
- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx:111`
- `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx:101`
- `src/modules/Workspace/presentations/views/InspectorPanel.tsx:45`
- `src/modules/Workspace/presentations/views/MixerPanel.tsx:95`
- `src/modules/Workspace/presentations/views/ClipView.tsx:61`
- `src/modules/Workspace/presentations/views/StatusBar.tsx:50`
- `src/modules/Workspace/presentations/views/Transport/TransportControls.tsx:60`
- `src/modules/Workspace/presentations/views/Transport/UndoRedoButtons.tsx:17`
- `src/modules/Workspace/presentations/views/Transport/ProjectName.tsx:63`
- `src/modules/Workspace/presentations/views/TempoEditor.tsx:17`
- `src/modules/Workspace/presentations/views/ToolSelector.tsx:32`
- `src/modules/Project/presentations/views/ArrangementSelector.tsx:99`
- `src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx:165`
- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx:137`
- `src/modules/Command/presentations/views/CommandPalette.tsx:70`

The pattern is nearly identical:

- `linear-gradient(180deg, #080808 0%, #0e0e0e 100%)`
- `inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)`
- a top rim-light and darker bottom seam

### Recommendation

Promote this to system-level DAW primitives:

- `@utility daw-toolbar-surface`
- `@utility daw-header-band`
- optionally a `DawHeaderBand` / `DawPanelHeader` component for layouts that always combine title, actions, and sticky behavior

This is the single largest low-risk consolidation opportunity outside plugin panels.

---

### 2. Floating menus and context surfaces are still hand-rolled repeatedly

Status: partially addressed by `daw-floating-surface` and `DawUtilityPanel`; many DAW-facing custom menus have already converged, including arrangement menus plus the mixer/inspector popups in `ExpandedChannelStrip`, `IOSection`, and `TrackDevicesSection`, but this is not yet universal.

Custom floating menu surfaces are repeated instead of using the shared floating/menu treatment:

- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:375`
- `src/modules/Arrangement/presentations/views/TrackContextMenu.tsx:233`
- `src/modules/Arrangement/presentations/views/MarkerLane.tsx:254`
- `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx:83`

These menus duplicate:

- dark gradient panel background
- floating shadow
- hairline separators
- hoverable menu rows

### Recommendation

Two improvements are needed:

1. Add a shared `daw-context-surface` utility for any truly custom positioned popover.
2. Wherever possible, migrate these views to shared menu primitives built on `DropdownMenu` / `ContextMenu` styling instead of local menu rendering.

The design system now already has a much stronger dropdown surface in `src/components/ui/dropdown-menu.tsx`; these arrangement menus should converge toward it.

---

### 3. Factory plugin “section wrappers” are repeated enough to become plugin-shell primitives

Across the flagship-style bottom panels, the same wrapper concepts are recreated locally:

- metric cards
- side cards / section cards
- themed windows
- tiny contextual headings
- quick-read tiles

Examples:

- `src/modules/Toaster/presentations/views/ToasterPanel.tsx:19`
- `src/modules/Proof/presentations/views/ProofPanel.tsx:92`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:194`
- `src/modules/Fermenter/presentations/views/FermenterPanel.tsx:114`
- `src/modules/Levain/presentations/views/LevainPanel.tsx:38`
- `src/modules/Yeast/presentations/views/YeastPanel.tsx:35`
- `src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx:63`
- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:17`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:202`
- `src/modules/Crust/presentations/views/CrustPanel.tsx:52`

The files currently each define local variations such as:

- `MetricTile`
- `SectionCard`
- `SideCard`
- `ControlCard`

### Recommendation

Add a small plugin-shell presentation kit, likely under `src/components/daw` or `src/components/ui`, with themeable slots:

- `PluginMetricTile`
- `PluginSectionCard`
- `PluginRailCard`
- `PluginDeckHeading`
- `PluginChipGroup`

These should not erase plugin flair. They should accept theme classes or CSS variables so each plugin can still feel distinct while sharing structure and spacing.

This is the clearest repeated pattern that deserves promotion into the design system.

---

### 4. Plugin-specific chip/button patterns are duplicated across many panels

There is a repeated chip grammar across plugin panels:

- small uppercase labels
- rounded pill surface
- active variant with theme accent
- subtle hover and pressed motion

Examples:

- `grinder-chip`, `grinder-chip-active`
- `proof-chip`, `proof-chip-active`
- `toaster-chip`, `toaster-chip-active`
- `fermenter-chip`, `fermenter-chip-active`
- `gluten-chip`, `gluten-chip-active`
- `bacteria-chip`, `bacteria-chip-active`

These are useful and visually strong, but the structure is repeated over and over in `main.css`.

### Recommendation

Introduce a more generic chip foundation:

- `plugin-chip`
- `plugin-chip-active`

Then let each plugin override theme tokens such as:

- `--plugin-accent`
- `--plugin-accent-soft`
- `--plugin-led`

This would reduce the amount of plugin-specific CSS while keeping each faceplate distinct.

---

### 5. Several places still use raw `input[type="range"]` instead of system controls

Current range-input examples:

- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:450`
- `src/modules/Crust/presentations/components/CrustControlZone.tsx:206`
- `src/modules/Crust/presentations/components/CrustControlZone.tsx:219`
- `src/modules/AiRuntime/presentations/views/PatternBrowser.tsx:131`
- `src/modules/Workspace/presentations/views/Inspector/layouts/HammondB3Layout.tsx:36`
- `src/modules/Fermenter/presentations/views/FermenterPanel.tsx:384`

These are not all the same use case:

- some want a mini horizontal parameter slider
- one is a vertical drawbar
- one is a keyboard velocity strip

### Recommendation

Do not force all of these onto the same component. Instead add a small family:

- `MiniSlider`
- `VerticalDrawbar`
- `InlineValueSlider`

The current `Slider` component is a good base, but these variants need lighter wrappers tailored to these recurrent use cases.

---

### 6. Crust still contains a lot of pre-system control styling

`Crust` was improved at the shell level, but the internal controls still rely on hardcoded hex colors and local button styling:

- `src/modules/Crust/presentations/components/CrustGainStrip.tsx`
- `src/modules/Crust/presentations/components/CrustControlZone.tsx`

Examples include:

- hardcoded rail and thumb colors
- local “pill” and “switch” button styling
- local subpanel framing
- local knob labels and readouts

### Recommendation

Crust should be refactored onto:

- shared DAW fader/mini-slider primitives
- shared plugin chip/toggle primitives
- shared inset/section wrappers

This is one of the clearest modules where the shell got upgraded faster than the internal control system.

---

### 7. Virtual Keyboard is visually strong but is still almost entirely bespoke

`src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx` still hand-rolls:

- root panel background
- control bar chrome
- white/black key surfaces
- velocity slider
- separators and labels

A lot of that is reasonable because the keyboard itself is a custom instrument surface. But the surrounding chrome is not unique enough to stay bespoke.

### Recommendation

Split the component into:

- reusable keyboard chrome primitives
    - `KeyboardToolbar`
    - `KeyboardValueStrip`
    - `KeyboardPanelSurface`
- custom piano key rendering that remains local

The keys themselves should stay custom. The framing around them should move closer to the shared system.

---

### 8. AI Runtime panels still duplicate a lot of shell work already solved elsewhere

Status: partially addressed. `ChatPanel`, `GenerativeAiPanel`, `PromptBar`, `LlmStatusBadge`, and related utility surfaces are more centralized now, but AI analysis/detail interiors still have local repeated micro-surfaces.

The AI panels still use local header/footer chrome and low-level layout styling:

- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx`
- `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx`

Repeated issues:

- inline top/bottom chrome gradients
- local footer bands
- local mini mode toggles
- local bordered boxes for selected assets / empty states

### Recommendation

Promote a few understated app-shell primitives for side panels:

- `SidePanelShell`
- `SidePanelHeader`
- `SidePanelFooter`
- `EmptyStateCard`

These should be more understated than plugin shells, but they still should not be reinvented per panel.

---

### 9. Arrangement and Inspector shells still need a shared “DAW panel chrome” layer

Status: partially addressed by the first neutral-shell primitive pass (`DawHeaderBand`, `DawEmptyState`, `DawSideRail`, `DawGridHeaderCell`, `DawDisplaySurface`, `DawAnalysisCard`), but the surrounding family is not complete.

Beyond toolbar strips, there is repeated broader shell framing in:

- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx`
- `src/modules/Arrangement/presentations/views/TrackListView.tsx`
- `src/modules/Workspace/presentations/views/InspectorPanel.tsx`
- `src/modules/Workspace/presentations/views/Inspector/*`
- `src/modules/Workspace/presentations/views/ClipView/*`
- `src/modules/Workspace/presentations/views/RoutingMatrix.tsx`
- `src/modules/Workspace/presentations/views/RoutingGraph.tsx`

These files are still frequently hand-rolling:

- panel headers
- separator seams
- subpanel wells
- inspector section headers

### Recommendation

The DAW-wide system needs a non-plugin counterpart to the plugin shell kit:

- `DawPanelShell`
- `DawSectionHeader`
- `DawInsetWell`
- `DawMetricStrip`
- `DawEmptyState`

This is the next real step after the shared primitive pass already done in `src/components/ui`.

---

### 10. Repeated micro-visualization patterns should become tiny reusable pieces

There are several small repeated patterns that are not full components yet, but are repeated often enough to deserve standardization:

- simple horizontal metric bars
    - `src/modules/Gluten/presentations/views/GlutenPanel.tsx:202`
    - `src/modules/Grinder/presentations/views/GrinderPanel.tsx:257`
- tiny status/quick-read tiles
    - many plugin panels
- small icon+label+detail cards
    - plugin preset cards
    - AI side panels
    - arrangement inspector lists

### Recommendation

Add a micro-kit:

- `MeterBar`
- `StatusTile`
- `SelectionCard`
- `QuickReadTile`

These are ideal “small but high-leverage” additions because they will reduce a lot of repetitive presentational code.

---

### 11. Side-panel and utility-shell layouts are repeated across AI, collaboration, project, and browser surfaces

Status: partially addressed by `DawUtilityPanel`, `DawSideRail`, and shared floating surfaces, but some utility-panel interiors still duplicate local framing and item grammar.

Several non-plugin side panels are structurally similar but still implemented separately:

- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx`
- `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx`
- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx`
- `src/modules/Project/presentations/views/ArrangementSelector.tsx`
- `src/modules/AudioEngine/presentations/views/PluginBrowser.tsx`
- `src/modules/SampleLibrary/presentations/views/LibraryBrowser.tsx`

Common repeated structure:

- left or right anchored narrow shell
- compact metal header
- scrollable content body
- compact footer or action strip
- empty-state or selected-item card inside the body

### Recommendation

Add a shared understated app-shell family:

- `UtilityPanelShell`
- `UtilityPanelHeader`
- `UtilityPanelFooter`
- `UtilitySelectionCard`
- `UtilityEmptyState`

These should sit below plugin flair in visual intensity and become the standard for utility panels around the DAW.

---

### 12. Transport-area components still share a repeated chrome language without shared primitives

Status: partially addressed by `daw-readout-well`, `DawControlStrip`, and several migrated transport/project widgets, but compact readout and meter rows remain duplicated.

The transport cluster still duplicates top-bar and display-well styling in many places:

- `src/modules/Workspace/presentations/views/Transport/TransportControls.tsx`
- `src/modules/Workspace/presentations/views/Transport/PanelToggles.tsx`
- `src/modules/Workspace/presentations/views/Transport/SoloModeSelector.tsx`
- `src/modules/Workspace/presentations/views/Transport/UndoRedoButtons.tsx`
- `src/modules/Workspace/presentations/views/Transport/ProjectName.tsx`
- `src/modules/Workspace/presentations/views/Transport/PlayheadDisplay.tsx`

There are really two separate reusable patterns here:

1. transport chrome strip surfaces
2. segmented readout wells for BPM/timecode/project displays

### Recommendation

Promote both:

- `TransportSurface`
- `TransportReadout`
- `TransportSegmentedDisplay`

`PlayheadDisplay.tsx` in particular should not keep hand-rolling its readout well styling when similar inset displays will likely appear elsewhere.

---

### 13. Inspector sections are repeating a “stacked header + inset body” pattern that should be systemized

There is a broad class of inspector sections that appear to be built independently but actually share one interaction pattern:

- `TrackDevicesSection.tsx`
- `TrackClipsSection.tsx`
- `TrackAutomationSection.tsx`
- `SignalFlowSection.tsx`
- `SendsEditor.tsx`
- `TrackRoutingSection.tsx`
- `TrackHeaderSection.tsx`
- `TrackLatencySection.tsx`
- `TrackLevelSection.tsx`

They are all variations of:

- understated DAW header strip
- section title and optional actions
- inset content body
- optional scrollable list

### Recommendation

Add inspector-specific system pieces:

- `InspectorSection`
- `InspectorSectionHeader`
- `InspectorSectionBody`
- `InspectorListCard`

This will make the inspector much easier to evolve without drifting visually from section to section.

---

### 14. Arrangement timeline support UI still uses repeated local menu, chip, and strip patterns

The arrangement canvas itself is custom and should stay custom, but the surrounding support UI still duplicates a lot:

- `ArrangementBar.tsx`
- `TrackContextMenu.tsx`
- `ClipContextMenu.tsx`
- `MarkerLane.tsx`
- `TrackListView.tsx`
- `TimelineEmptyMenu.tsx`
- `ArrangeView.tsx`

Repeated patterns include:

- custom context menus
- simple color swatch rows
- narrow strip headers
- tiny divider seams
- small drag-thumb scrollbars

### Recommendation

Add supporting arrangement primitives rather than styling these ad hoc:

- `ColorSwatchRow`
- `TimelineContextSurface`
- `MiniScrollbar`
- `StripHeaderBand`

The current `ArrangeView.tsx` horizontal scrollbar is especially a good candidate for a reusable `MiniScrollbar` because similar bottom-strip navigation affordances are likely to recur.

---

### 15. Small label systems are duplicated everywhere and need typography tokens or tiny primitives

Status: partially addressed by `DawMicroBadge`, `DawSectionDivider`, sidebar `SearchSummary`, and some migrated micro-label families, but typography is still only partly tokenized.

The app repeats a lot of very small uppercase label styling:

- `text-[8px] uppercase tracking-[0.24em]`
- `text-[8px] uppercase tracking-[0.22em]`
- `text-[8px] uppercase tracking-[0.26em]`
- `text-[9px] font-mono`
- `text-[10px] font-medium`

This is everywhere:

- plugin metric tiles
- transport readouts
- inspector sections
- arrangement strips
- collaboration panels
- proof chamber decks
- scoring, toaster, levain, gluten, bacteria, crust, fermenter, yeast, grinder

### Recommendation

Add typographic micro-primitives or utility classes for:

- eyebrow labels
- deck labels
- metric labels
- mono readouts
- quick-read numbers

This is lower urgency than surface primitives, but the repetition level is high enough that typography tokens would reduce a lot of visual drift.

---

### 16. Empty-state and “desktop required” cards should be standardized

Status: partially addressed by `DawEmptyState` and broader sidebar/utility-panel empty-state reuse, but a few feature-gate and picker-specific variants still remain.

There are multiple variants of informational empty/blocked states:

- `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx`
- `src/modules/AudioEngine/presentations/views/PluginBrowser.tsx`
- `src/modules/AudioEngine/presentations/views/PluginScanSettings.tsx`
- `src/modules/Workspace/presentations/views/ClipView/WaveformEditor.tsx`
- `src/modules/Workspace/presentations/views/ArrangeView.tsx`

Current variants differ in:

- border style
- copy style
- icon treatment
- inset surface
- spacing

### Recommendation

Create:

- `EmptyStateCard`
- `FeatureGateCard`
- `SelectionRequiredCard`

These should support icon, title, body, and optional action while staying visually understated.

---

### 17. Repeated “selected entity summary” cards should be promoted

Several views render a compact summary card for the currently selected thing:

- selected pad in `ToasterPanel.tsx`
- selected clip or audio clip in `GenerativeAiPanel.tsx`
- preset or target cards in `ProofPanel.tsx`
- active topology/style cards in `GlutenPanel.tsx`
- quick-read and current-rig cards in `GrinderPanel.tsx`

### Recommendation

Add a general-purpose:

- `SelectionSummaryCard`

It should support:

- icon or swatch
- title
- subtitle
- optional status pill
- optional accent border/glow

This is a strong candidate because it appears in both plugin UIs and broader DAW utility panels.

---

### 18. The app needs a clearer split between DAW primitives and plugin primitives

One thing that becomes clear after scanning broadly is that the repo now has two different UI languages that are both valid:

1. understated structural DAW UI
2. richer themed plugin UI

Right now that split is implicit rather than explicit.

### Recommendation

Formally separate design-system layers:

- **DAW primitives**
    - calmer surfaces
    - neutral headers
    - inspector/transport/sidebar shells
    - context and utility panels
- **Plugin primitives**
    - themed faceplates
    - themeable metric cards
    - deck sections
    - plugin chips, LEDs, and quick-read tiles

This would reduce confusion about when something should use a quiet DAW pattern versus a richer plugin-shell pattern.

---

### 19. Sidebar/tab-rail navigation patterns are starting to repeat and should be normalized

Status: partially addressed by `DawSideRail`, `DawGridHeaderCell`, and the sidebar-local summary/divider cleanup, but full rail/nav-item standardization is still open.

There are several horizontally or vertically tabbed navigation bands that are each solving the same problem slightly differently:

- `src/modules/Workspace/presentations/views/Sidebar.tsx`
- `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx`
- `src/modules/Workspace/presentations/views/PreferencesDialog.tsx`
- `src/modules/Workspace/presentations/views/SessionView.tsx`
- several plugin browse rails

Current differences include:

- button sizing
- active-state emphasis
- scroll affordances
- chevron overlay styling
- divider treatments

### Recommendation

Create small navigation primitives:

- `TabRail`
- `TabRailScroller`
- `SidebarNavList`
- `SidebarNavItem`

These should support both understated DAW shells and richer plugin rails through theme modifiers rather than separate bespoke implementations.

---

### 20. Device/preset picker menus are repeated enough to deserve shared picker surfaces

The app has multiple picker-style interfaces that are not technically the same component but share a lot of interaction language:

- `TrackDevicesSection.tsx`
- `PluginBrowser.tsx`
- `ArrangementSelector.tsx`
- `LibraryBrowser.tsx`
- preset rails in several plugin panels

Repeated patterns:

- grouped lists with tiny uppercase group headers
- scrollable option lists
- small active-state borders
- optional badges like plugin format or category
- hoverable row items

### Recommendation

Introduce a composable picker kit:

- `PickerSurface`
- `PickerGroupLabel`
- `PickerItem`
- `PickerBadge`
- `PickerSearchField`

This would clean up a lot of custom list UIs without forcing everything into a single giant browser component.

---

### 21. Readout wells and micro-status displays should become shared display primitives

Status: partially addressed by `daw-readout-well`, `DawDisplaySurface`, `DawStatusDot`, `DawMeterBar`, and `DawReadoutRow`, but several compact status clusters and analysis-side adopters remain local.

A number of views render compact hardware-like readouts:

- `PlayheadDisplay.tsx`
- `StatusBar.tsx`
- plugin metric tiles
- scoring quick-read areas
- proof quick-read strips

Some are large segmented displays, some are compact bars, some are mono numeric tiles, but they all share:

- inset well treatment
- mono emphasis
- tiny uppercase label
- optional active coloration

### Recommendation

Add a display family:

- `ReadoutWell`
- `ReadoutLabel`
- `ReadoutValue`
- `SegmentedReadout`
- `MiniStatusBar`

This is especially important for the transport and status bar because those areas should feel precise and restrained, not handcrafted one-off each time.

---

### 22. Workspace-level dialogs need a calmer shared modal interior language

Several dialogs are already using `Dialog`, but the internals still drift:

- `PreferencesDialog.tsx`
- `ExportDialog.tsx`
- `BranchManagerDialog.tsx`
- `MergeResultDialog.tsx`
- `MixHealthDialog.tsx`

Repeated internal patterns:

- left navigation rails
- section dividers
- footer action rows
- feature badges / progress areas

### Recommendation

Extend the dialog system with shared substructure:

- `DialogSidebar`
- `DialogBodySection`
- `DialogFooterActions`
- `DialogMetricNotice`

This would let dialogs feel related without making them look like generic web admin forms.

---

### 23. Status/selection/empty-state copy patterns should become reusable content components, not just styles

Status: partially addressed by `DawEmptyState`, `DawInlineHint`, and sidebar `SearchSummary`, but selection-summary and richer blocked-state content patterns are still fragmented.

There are many small status blocks that are structurally similar:

- “No track selected”
- “No folders connected”
- “Desktop app required”
- “No nearby sessions found”
- “No tracks in the oven yet”
- selected clip / selected pad / selected target summaries

Concrete current examples:

- `src/modules/AudioEngine/presentations/views/PluginBrowser.tsx:48`
- `src/modules/AudioEngine/presentations/views/PluginScanSettings.tsx:35`
- `src/modules/SampleLibrary/presentations/views/LibraryBrowser.tsx:175`
- `src/modules/Collaboration/presentations/views/NearbyPanel.tsx:63`
- `src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx:169`
- `src/modules/Workspace/presentations/views/MixerPanel.tsx:219`
- `src/modules/Workspace/presentations/views/AutomationLane/CCLane.tsx:129`
- `src/modules/Workspace/presentations/views/AutomationLane/PitchBendLane.tsx:130`
- `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx:171`

This is partly a styling issue, but also a content-structure issue.

### Recommendation

Create a small content primitive layer:

- `EmptyStateBlock`
- `SelectionSummary`
- `FeatureStatusBadge`
- `InlineNotice`

These should enforce icon/title/body/action structure so the app stops reinventing little status cards and notices in every module.

---

### 24. Some repeated separators and seams still exist outside the Separator primitive

Status: partially addressed by `DawSectionDivider` and existing seam utilities, but some local separator recipes remain.

A lot of views still render their own seam lines with custom inline gradients:

- `ArrangementBar.tsx`
- `TrackContextMenu.tsx`
- `MarkerLane.tsx`
- `MixerPanel.tsx`
- `PreferencesDialog.tsx`
- `SessionView.tsx`
- `GenerativeAiPanel.tsx`

### Recommendation

The current `Separator` is better than before, but the app still needs dedicated seam utilities:

- `daw-separator`
- `daw-seam-horizontal`
- `daw-seam-vertical`

or thin wrapper components around `Separator` for the common DAW seam look.

That would eliminate a lot of tiny inline gradients that are visually consistent but still repeated manually.

---

### 25. A few dialogs still bypass the shared dialog system entirely

Some modal flows are still building their own fixed overlays, window chrome, and action rows instead of composing the existing dialog primitives:

- `src/modules/CrdtDocument/presentations/views/BranchManagerDialog.tsx`
- `src/modules/CrdtDocument/presentations/views/MergeResultDialog.tsx`
- `src/modules/Project/presentations/views/ExportDialog.tsx`

This creates three problems:

- overlay styling drifts from the calmer DAW shell language
- action rows and spacing differ from modal to modal
- “simple result dialog” and “manager dialog” patterns are not reusable

### Recommendation

Standardize around shared dialog internals, not just `Dialog` itself:

- `DialogShell`
- `DialogHeaderBand`
- `DialogActionRow`
- `DialogFeatureCard`
- `DialogEmptyState`

`PreferencesDialog.tsx` already points in the right direction because it uses the shared dialog foundation. The remaining custom modals should move in that direction instead of hand-rolling overlays.

---

### 26. Transport controls are split across too many bespoke micro-shells

Status: partially addressed. The transport family is materially more centralized than at audit start, but it still needs a dedicated compact readout/meter-row pass.

The transport area is not only repeating chrome styling; it is also repeating a structural cluster pattern across many tiny components:

- `src/modules/Workspace/presentations/views/Transport/TransportControls.tsx`
- `src/modules/Workspace/presentations/views/Transport/PanelToggles.tsx`
- `src/modules/Workspace/presentations/views/Transport/UndoRedoButtons.tsx`
- `src/modules/Workspace/presentations/views/Transport/SoloModeSelector.tsx`
- `src/modules/Workspace/presentations/views/Transport/ProjectName.tsx`
- `src/modules/Workspace/presentations/views/Transport/PlayheadDisplay.tsx`
- `src/modules/Workspace/presentations/views/ToolSelector.tsx`

These are all using variations of the same underlying product structure:

- compact top-bar cluster shell
- one or more tactile buttons or toggles
- optional inset readout well
- subtle seam/rim-light handling

The latest sweep also shows that this family extends into adjacent project and timing widgets, not just the obvious transport buttons:

- `src/modules/Workspace/presentations/views/TempoEditor.tsx:17`
- `src/modules/Workspace/presentations/views/ToolSelector.tsx:32`
- `src/modules/Project/presentations/views/ArrangementSelector.tsx:99`
- `src/modules/Project/presentations/views/RecentProjectsMenu.tsx`

### Recommendation

Add explicit transport primitives rather than letting every cluster restyle itself:

- `TransportClusterShell`
- `TransportButtonGroup`
- `TransportPillReadout`
- `TransportSegmentedDisplay`
- `TransportInlineField`

This would let the transport remain understated while removing a lot of repeated top-bar framing logic.

---

### 27. Picker and browser surfaces are proliferating without a shared “picker grammar”

The app now has many pickers, browsers, and chooser surfaces that are functionally different but visually very close:

- `src/modules/AudioEngine/presentations/views/PluginBrowser.tsx`
- `src/modules/AudioEngine/presentations/views/PluginScanSettings.tsx`
- `src/modules/Project/presentations/views/ArrangementSelector.tsx`
- `src/modules/Project/presentations/views/TemplateChooser.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx`
- `src/modules/SampleLibrary/presentations/views/LibraryBrowser.tsx`

Repeated patterns include:

- compact search rows
- grouped result sections
- empty-state cards
- selected-item cards
- “desktop app required” / “nothing connected” / “no results” states
- inline action rows for add, duplicate, rescan, rename, and load

### Recommendation

Promote a shared picker/browse language:

- `PickerSurface`
- `PickerSearchRow`
- `PickerGroupHeader`
- `PickerEmptyState`
- `PickerActionRow`
- `PickerListItem`

This should stay calmer than plugin shells and more utility-oriented, but it should stop being reinvented in every chooser.

---

### 28. List rows and selectable browser items need a reusable row/card primitive

Many views now share a very similar row interaction pattern but still implement it independently:

- `src/modules/SampleLibrary/presentations/components/LibraryRootCard.tsx`
- `src/modules/SampleLibrary/presentations/components/SampleRow.tsx`
- `src/modules/Collaboration/presentations/views/NearbyPanel.tsx`
- `src/modules/AudioEngine/presentations/views/PluginBrowser.tsx`
- `src/modules/CrdtDocument/presentations/views/BranchManagerDialog.tsx`

The pattern repeats:

- icon or status glyph on the left
- main label + secondary metadata
- optional trailing badge or action buttons
- hover/selected/active states
- compact height tuned for dense browsing

### Recommendation

Add a lightweight row primitive family:

- `SelectableRow`
- `BrowserRow`
- `RowBadge`
- `RowMeta`
- `RowActions`

This would help a lot of sidebars and browsers feel coherent without flattening them into one giant component.

---

### 29. Sidebar rails and overflow tab scrollers should be standardized

There are now several navigation rails and compact tab scrollers that solve the same layout problem in slightly different ways:

- `src/modules/Workspace/presentations/views/Sidebar.tsx`
- `src/modules/Workspace/presentations/views/PreferencesDialog.tsx`
- plugin left rails and section tabs
- browser/picker category strips in multiple modules

`Sidebar.tsx` is especially revealing because it has a bespoke scrollable tab bar with overlay chevrons, while other places solve similar problems with simple button rows or stacked nav lists.

### Recommendation

Split this into a real navigation primitive family:

- `TabRail`
- `NavRail`
- `ScrollableTabStrip`
- `OverflowChevron`

This would make compact-width and compact-height navigation more consistent across the DAW.

---

### 30. Utility workspaces like Session View still hand-roll shell pieces that should be shared

Some larger non-plugin workspaces are still composing their shell one seam at a time:

- `src/modules/Workspace/presentations/views/SessionView.tsx`
- `src/modules/Workspace/presentations/views/MixerPanel.tsx`
- `src/modules/Workspace/presentations/views/InspectorPanel.tsx`
- `src/modules/Workspace/presentations/views/RoutingMatrix.tsx`

`SessionView.tsx` is a good example because it hand-rolls:

- header chrome
- scene column chrome
- track-column header band
- grid well surfaces

All of that is valid product-specific layout, but the surface language is not unique enough to stay fully bespoke.

### Recommendation

Expand the neutral DAW shell kit with:

- `WorkspaceHeaderBand`
- `WorkspaceGridChrome`
- `WorkspaceAxisHeader`
- `WorkspaceEmptyGridState`

This would help larger workspaces feel related without forcing them into identical layouts.

---

### 31. Shared Dialog adoption is still only skin-deep in some flows

Some views are already using `Dialog`, but still hand-roll nearly all of the interior structure:

- `src/modules/Command/presentations/views/CommandPalette.tsx`
- `src/modules/Workspace/presentations/views/PreferencesDialog.tsx`
- `src/modules/Project/presentations/views/ExportDialog.tsx`
- `src/modules/Project/presentations/views/TemplateChooser.tsx`

The recurring issue is not the overlay anymore; it is the lack of shared interior grammar:

- custom header bands
- custom sidebars
- custom action strips
- custom listbox wells
- custom success/error/result blocks

### Recommendation

In addition to shared modal wrappers, the design system should expose interior building blocks:

- `DialogBand`
- `DialogSidebar`
- `DialogListWell`
- `DialogResultCard`
- `DialogActionRow`

That would keep modal UX calmer and more consistent without making every dialog look identical.

---

### 32. The app still lacks a complete DAW form kit for selects, small fields, and inline editors

Status: partially addressed by `DawCompactSelect`, now adopted in `PianoRollToolbar`, `AutomationLane`, `TempoEditor`, `TrackMidiOutputSection`, `TrackVcaSection`, `InputSelector`, `ClipInspector`, `DeviceParameterControl`, `PatternBrowser`, and the save form in `InstrumentsTab`, but the broader field/edit family is still fragmented.

Many module-level views are still styling compact DAW form controls directly instead of composing thin themed wrappers:

- `src/modules/AudioEngine/presentations/views/AudioDevicePicker.tsx`
- `src/modules/AudioEngine/presentations/views/MidiDevicePicker.tsx`
- `src/modules/Project/presentations/views/ArrangementSelector.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackHeaderSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/ClipInspector.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx`
- `src/modules/Workspace/presentations/views/TempoEditor.tsx`
- `src/modules/Arrangement/presentations/views/TrackHeader/InputSelector.tsx`

Repeated patterns include:

- compact selects with the same overlay border treatment
- inline rename inputs
- tiny labels above fields
- value readouts paired with sliders
- button-like inline editor rows

### Recommendation

The design system needs a small DAW form layer, calmer than plugin controls:

- `DawCompactSelect` for neutral shell selectors
- `DawSelect` or a broader field wrapper only if the remaining non-compact cases truly converge
- `DawFieldLabel`
- `DawInlineEditor`
- `DawSliderField`
- `DawValueReadout`

This would eliminate a lot of hand-themed form code while keeping the DAW shell restrained.

---

### 33. Inspector subsections repeat the same local card and well language

Status: partially addressed by the inspector-local `ControlHeader`, `InsetPanel`, `SurfaceCard`, and `MetaText` helpers now shared across `ClipInspector`, `ClipGainEnvelopeSection`, `TrackLevelSection`, `TrackHeaderSection`, `TrackNotesSection`, `SendsEditor`, `ClipAudioAiSection`, `TrackMidiOutputSection`, `TrackVcaSection`, `TrackRoutingSection`, `TrackAutomationSection`, `SignalFlowSection`, `DeviceInspector`, `TrackClipsSection`, `TrackAlternativesSection`, and `TakesSection`, but the broader inspector card/well family is still local and inconsistent.

The inspector is not just repeating section headers; it is also repeating a specific inset-card treatment for local editing blocks:

- `src/modules/Workspace/presentations/views/Inspector/ClipInspector.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackHeaderSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/DeviceInspector.tsx`
- `src/modules/Workspace/presentations/views/Inspector/SignalFlowSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackNotesSection.tsx`

These files repeatedly combine:

- small uppercase section labels
- inset card or well backgrounds
- compact field groups
- tiny separators
- local empty/help text

### Recommendation

Extend the inspector kit beyond headers:

- `InspectorCard`
- `InspectorFieldGroup`
- `InspectorMetaRow`
- `InspectorEmptyHint`
- `InspectorInlineToggle`

This would let the inspector feel much more unified without forcing every device or clip layout into the same exact markup.

---

### 34. Tiny label typography is still effectively a code pattern, not a tokenized system

Across the DAW and plugin shells, very small labels are still being rebuilt as literal class strings:

- `text-[8px] uppercase tracking-[0.24em]`
- `text-[8px] uppercase tracking-[0.22em]`
- `text-[9px] font-mono`
- `text-[10px] text-muted-foreground`

This shows up across:

- plugin panels such as `CrustPanel.tsx` and `LevainPanel.tsx`
- browser rows such as `SampleRow.tsx` and `LibraryRootCard.tsx`
- transport and inspector readouts
- DAW controls like `Fader.tsx`, `MechanicalSwitch.tsx`, and `ValueField.tsx`

### Recommendation

Add semantic micro-typography utilities or tiny components:

- `label-micro`
- `label-micro-strong`
- `readout-micro`
- `readout-mono`

The goal is not to eliminate all typographic classes; it is to stop rebuilding the same tiny caption language by hand in dozens of places.

---

### 35. Floating utility overlays should have their own understated primitive family

Status: partially addressed by `DawUtilityPanel` and the shared floating-surface treatment.

Not every floating UI in the app is a menu or a dialog. Some are lighter utility overlays with their own recurring structure:

- `src/modules/AiRuntime/presentations/views/VoiceCommandOverlay.tsx`
- `src/modules/AiRuntime/presentations/views/AiActionHistoryPanel.tsx`
- command, history, and quick-status surfaces in nearby utility flows

These surfaces often share:

- floating neutral panel
- small icon-led status presentation
- compact text block
- close/undo/stop affordances

### Recommendation

Add a small family for floating utility surfaces:

- `UtilityOverlay`
- `UtilityOverlayHeader`
- `UtilityOverlayBody`
- `UtilityStatusPill`

This would keep these surfaces tactile and polished without overloading the menu or dialog primitives.

---

### 36. Status and metric clusters are still composed ad hoc across DAW shells

Status: partially addressed by the first `DawMeterBar` / `DawReadoutRow` adoption in `StatusBar`, `mixAnalysis`, `TrackLatencySection`, `TrackLevelSection`, `TrackRoutingSection`, `ClipInspector`, and `LUFSMeter`, but this remains one of the highest-value neutral-shell follow-up passes.

Several views build dense little metric groups out of raw spans, bars, pills, and mono readouts instead of using a shared cluster pattern:

- `src/modules/Workspace/presentations/views/StatusBar.tsx`
- `src/modules/Workspace/presentations/views/Transport/PlayheadDisplay.tsx`
- `src/modules/AiRuntime/presentations/views/AiActionHistoryPanel.tsx`
- multiple plugin quick-read strips and meter sections

The recurring structure is:

- tiny label
- compact meter or readout
- numeric/mono value
- optional active state color

### Recommendation

Add a neutral DAW metric cluster family:

- `MetricCluster`
- `MetricLabel`
- `MetricValue`
- `MetricBar`
- `MetricStatusDot`

This is slightly different from plugin metric tiles because these clusters usually live in denser, calmer DAW shells like the transport and status bar.

---

### 37. Card-based chooser UIs are repeating their own local grammar

Some app flows use more visual, card-led selection instead of dense rows, but they are still building that language locally:

- `src/modules/Project/presentations/views/TemplateChooser.tsx`
- plugin preset rails and amp cards
- selection-summary cards in various plugin and DAW surfaces

The repeated card structure includes:

- icon tile or accent icon well
- title + subtitle
- optional badge
- short descriptive body
- hover/active elevation changes

### Recommendation

The system should include a reusable chooser-card layer:

- `ChooserCard`
- `ChooserCardIcon`
- `ChooserCardMeta`
- `ChooserCardBadge`

These should be themeable enough for plugins while still working in calmer DAW flows like template selection.

---

### 38. Some views still define local animation and ornament inline instead of using tokenized motion or surface helpers

Most inline styling is structural, which is fine, but a few files are still carrying fully local ornament and motion definitions:

- `src/modules/Project/presentations/views/TemplateChooser.tsx`
- plugin and browser shells with bespoke shimmer, glow, or decorative gradients

The clearest example is `TemplateChooser.tsx`, which includes an inline `<style>` block for `tc-shimmer` and local gradient/glow treatments that are visually good but not systemized.

### Recommendation

Add a tiny motion and ornament layer for approved DAW/plugin effects:

- `surface-glow-soft`
- `loading-shimmer-inline`
- `accent-halo`

This does not mean centralizing every animation. It means centralizing the handful that are good enough to repeat so later work does not reinvent them slightly differently each time.

---

### 39. Hierarchical browser and tree patterns are repeating without shared primitives

The app now has several places that render expandable or grouped hierarchies, but each one still invents its own row chrome and indentation rules:

- `src/modules/SampleLibrary/presentations/components/FolderTree.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/SamplesTab.tsx`
- `src/modules/Project/presentations/views/ArrangementSelector.tsx`
- `src/modules/Arrangement/presentations/views/TrackListView.tsx`

Common repeated structure:

- left icon or disclosure glyph
- nested indentation
- small metadata count on the right
- selected and hover row states
- grouped sublists with compact headers

### Recommendation

Add a lightweight hierarchy kit:

- `TreeRow`
- `TreeDisclosure`
- `TreeMeta`
- `GroupedListSection`

This does not mean one universal tree component. It means a shared row grammar for collapsible or grouped browsers.

---

### 40. Color-preset and swatch selection patterns should be standardized

Color selection appears in several places with very similar interaction patterns:

- `src/modules/Workspace/presentations/views/Inspector/TrackHeaderSection.tsx`
- `src/modules/Arrangement/presentations/views/TrackContextMenu.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/ColorTab.tsx`
- plugin/preset accent pickers and swatch-led summaries in other panels

The repeated grammar is:

- tiny swatch buttons or chips
- optional active outline
- compact label row
- optional icon or accent metadata

### Recommendation

Promote a swatch family:

- `ColorSwatch`
- `ColorSwatchGrid`
- `ColorSwatchRow`
- `AccentChip`

This would reduce repeated little color-button implementations and help color-selection flows stay visually consistent.

---

### 41. Matrix and graph workspaces need a shared “diagram editor chrome” layer

The DAW has multiple views that are really diagram or matrix workspaces rather than simple forms or lists:

- `src/modules/Workspace/presentations/views/RoutingMatrix.tsx`
- `src/modules/Workspace/presentations/views/RoutingGraph.tsx`
- `src/modules/Workspace/presentations/views/SessionView.tsx`
- arrangement support surfaces around the timeline and clip grid

The custom geometry in these views should stay local, but the surrounding shell language keeps repeating:

- header band
- empty-grid state
- axis headers
- neutral grid background and wells
- compact matrix buttons and node labels

### Recommendation

Introduce a diagram-workspace primitive family:

- `DiagramWorkspace`
- `DiagramHeaderBand`
- `DiagramEmptyState`
- `MatrixCellButton`
- `AxisHeader`

This would keep graph and matrix views feeling like related parts of the DAW without over-constraining their actual geometry.

---

### 42. Compact tool and action clusters are still hand-built in many places

There are many tightly packed control groups that are not quite transport, not quite nav, and not quite plain buttons:

- `src/modules/Workspace/presentations/views/ToolSelector.tsx`
- `src/modules/Arrangement/presentations/views/TrackListView.tsx`
- transport sub-clusters
- contextual control strips in workspace shells

These commonly combine:

- a compact shell
- 3-6 icon buttons
- an optional divider seam
- one or two “special state” toggles

### Recommendation

Add a small action-cluster kit:

- `ActionCluster`
- `ActionClusterDivider`
- `ActionClusterToggle`

This would help top-bar and side-bar control groups converge without forcing everything into transport-specific primitives.

---

### 43. Several module-local helper components are already proto-primitives and should be promoted intentionally

Some of the best repeated UI patterns are no longer inline, but they are still trapped inside module-local helper files:

- `src/modules/Workspace/presentations/components/Sidebar/InstrumentCard.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/effectsTabHelpers.tsx`
- `src/modules/Workspace/presentations/components/LaunchScreen.tsx`
- local plugin helper cards in several flagship panels

Examples include:

- `InstrumentCard`
- `NavCard`
- `EffectItem`
- `ActionCard`

These are already close to reusable primitives, but because they live inside feature folders they are not discoverable or reusable across the app.

### Recommendation

Promote the strongest module-local helpers into explicit shared layers:

- `ChooserCard`
- `NavCard`
- `BrowserListItem`
- `ActionCard`

The important nuance is that not every local helper should be centralized. Only the ones that are clearly repeating the same product grammar across multiple modules should move.

---

### 44. Embedded mini-visual widgets need a lightweight shared wrapper language

Status: partially addressed by `DawAnalysisCard` and related measured-shell adoption, but analysis/metering internals still repeat local wrappers.

There are several compact visual widgets that are not full panels, but still need consistent framing and labeling:

- `src/modules/Workspace/presentations/components/MiniMasterSpectrum.tsx`
- small meter and spectrum widgets in workspace and plugin shells
- preview and analysis blocks in AI and browser surfaces

The drawing code itself should stay local, but the wrappers still repeat:

- title in the corner
- inset overlay or scanline treatment
- interactive hover/selected state
- compact host surface

### Recommendation

Add a minimal wrapper family for embedded visuals:

- `MiniVizShell`
- `MiniVizLabel`
- `MiniVizOverlay`

This would help small analyzers and preview widgets feel related without forcing their actual rendering logic into one component.

---

### 45. Onboarding and launch surfaces use their own card and glow language instead of the shared system

The entry-point UI is visually strong, but it currently lives on a mostly separate design island:

- `src/modules/Workspace/presentations/components/LaunchScreen.tsx`
- `src/modules/Project/presentations/views/TemplateChooser.tsx`

These surfaces share a lot:

- action cards
- category chips
- icon-led chooser cards
- ambient glows and shimmer/loading states

### Recommendation

The system should explicitly acknowledge an onboarding or welcome layer:

- `WelcomeSurface`
- `ActionCard`
- `TemplateCard`
- `AmbientGlowLayer`

This does not need to be used across the whole DAW, but it should still be part of the design system instead of a one-off visual island.

---

### 46. Automation lane micro-controls are repeating a small but distinct control grammar

Status: partially addressed by `AutomationControls.tsx`, but lane-local readouts and some compact controls still remain fragmented.

Automation editing introduces a lot of tiny overlay controls that are not quite toolbar buttons and not quite inspector controls:

- `src/modules/Workspace/presentations/views/AutomationView/AutomationLaneControls.tsx`
- related automation lane headers and row controls

The recurring pattern is:

- tiny icon buttons or abbreviated toggles
- hover-only or overlay presentation
- compact selected-count/readout pill
- subtle lane-surface hover states

### Recommendation

Add a micro-control layer for dense editing overlays:

- `OverlayIconButton`
- `OverlayCountPill`
- `LaneControlStrip`

This would help automation, clip editors, and other dense editing overlays feel related without borrowing heavier DAW shell components.

---

### 47. Mixer internals repeat a distinct channel-strip sub-language that should be formalized

Status: partially addressed by `DawChannelStripShell`, `DawMiniSectionHeader`, the shared floating-surface adoption in mixer popups, and the readout-row adoption in adjacent inspector/metering surfaces, but the broader strip-side micro-language is still open.

The mixer already uses strong primitives like `Fader`, `RotaryKnob`, and `LatchButton`, but the strip internals still repeat their own card/surface composition:

- `src/modules/Workspace/presentations/views/Mixer/ExpandedChannelStrip.tsx`
- `src/modules/Workspace/presentations/views/Mixer/MasterChannelStrip.tsx`
- `src/modules/Workspace/presentations/views/Mixer/DeviceChainSection.tsx`
- `src/modules/Workspace/presentations/views/Mixer/SendsSection.tsx`
- `src/modules/Workspace/presentations/views/Mixer/IOSection.tsx`

Repeated patterns include:

- channel cap/header
- inset rename/readout fields
- small rack sections
- context menus and color rails
- stacked utility sections inside a strip

### Recommendation

Promote a mixer sub-kit:

- `ChannelStripShell`
- `ChannelStripHeader`
- `ChannelInsetField`
- `ChannelRackSection`

This would keep the mixer feeling intentional and tactile without rebuilding strip internals one section at a time.

---

### 48. Metering components need a shared wrapper and labeling language even when the rendering stays custom

Status: partially addressed at the micro-family level by `DawMeterBar` / `DawReadoutRow`, but the broader wrapper and labeling language is still open and should stay on the near-term roadmap.

The metering views are correctly custom in their actual rendering logic, but the framing and labeling still repeat:

- `src/modules/Workspace/presentations/views/Metering/LevelMeter.tsx`
- `src/modules/Workspace/presentations/views/Metering/SpectrumAnalyzer.tsx`
- `src/modules/Workspace/presentations/views/Metering/Spectrogram.tsx`
- `src/modules/Workspace/presentations/views/Metering/Goniometer.tsx`
- `src/modules/Workspace/presentations/views/Metering/PhaseCorrelationDisplay.tsx`

Repeated patterns include:

- tiny dB scales
- inset black metering wells
- overlay gloss or edge shading
- small titles and value labels

### Recommendation

Add a metering wrapper family:

- `MeterShell`
- `MeterScale`
- `MeterLabel`
- `MeterOverlay`

This would let all metering widgets stay custom but feel more like siblings.

---

### 49. Analysis dashboards are building repeatable “instrument panel” cards locally

The analysis area is effectively a compact dashboard built from repeated panel cards:

- `src/modules/Workspace/presentations/views/AnalysisPanel.tsx`
- related metering and mini-analysis widgets

The local `AnalysisCard` pattern already has a clear structure:

- neutral panel shell
- understated header band
- visual content region
- flexible sizing for wide, square, or narrow cards

### Recommendation

This should become an explicit primitive instead of staying local:

- `DashboardCard`
- `DashboardCardHeader`
- `DashboardCardBody`

It would work well for analysis, diagnostics, and some AI-side insight panels.

---

### 50. Status badges and model badges deserve a shared pill/badge family

Status: partially addressed by `DawMicroBadge` and `DawStatusDot`, but adoption is still incomplete outside the most obvious prompt/sidebar/transport surfaces.

There are many small status pills, model badges, and approval/format markers across the app:

- `src/modules/Workspace/presentations/views/Prompt/LlmStatusBadge.tsx`
- `src/modules/AudioEngine/presentations/views/PluginBrowser.tsx`
- `src/modules/Collaboration/presentations/views/NearbyPanel.tsx`
- plugin and preset cards throughout the flagship panels

The repeated grammar is:

- compact rounded pill
- tiny uppercase or micro label
- optional icon
- status color or tier color

### Recommendation

Add a shared badge family:

- `StatusBadge`
- `TierBadge`
- `InlineBadge`

This would reduce repeated one-off badge styling and make state/tier labels more consistent across DAW and plugin surfaces.

---

### 51. Collaboration presence indicators should have a dedicated shared overlay grammar

Collaborative overlays are not generic menus or dialogs. They are a distinct visual layer:

- `src/modules/Collaboration/presentations/views/PresenceOverlay.tsx`
- related collaboration/presence surfaces

The repeated or likely-to-repeat pieces are:

- colored cursor line
- name tag
- focus dot
- collaborator marker overlays

### Recommendation

Introduce a collaboration overlay kit:

- `PresenceCursor`
- `PresenceTag`
- `PresenceDot`

The geometry stays local to the arrangement view, but the visual vocabulary should be shared if collaboration UI grows.

---

### 52. Context menus are starting to include inline editors and nested utility states that need a shared pattern

The arrangement and track context menus are no longer simple lists of actions:

- `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx`
- `src/modules/Arrangement/presentations/views/TrackContextMenu.tsx`
- `src/modules/Arrangement/presentations/views/TimelineEmptyMenu.tsx`

These menus now include:

- inline rename fields
- color pickers
- nested submenus and option groups
- small summary headers for multi-selection states

### Recommendation

The context-menu system should grow beyond a flat button list:

- `ContextMenuSection`
- `ContextMenuInlineEditor`
- `ContextMenuSwatchRow`
- `ContextMenuSummary`

This would keep richer context menus coherent instead of each file inventing its own mini-menu grammar.

---

### 53. Prompt and command surfaces are converging on their own compact interaction grammar

Status: partially addressed by the prompt/popup/readout cleanup already landed in `PromptBar`, `LlmStatusBadge`, `CommandPalette`, and related DAW utility surfaces.

There is a growing family of compact “command entry + status + suggestions” surfaces:

- `src/modules/Workspace/presentations/views/PromptBar.tsx`
- `src/modules/Command/presentations/views/CommandPalette.tsx`
- `src/modules/Workspace/presentations/views/Prompt/LlmStatusBadge.tsx`

These are not just generic forms. They share:

- compact inset command-entry shell
- token or tag chips
- suggestion rows
- status badge or dropdown panel
- confirmation/preview strips

### Recommendation

Create a command-surface layer:

- `CommandSurface`
- `CommandTagChip`
- `CommandSuggestionRow`
- `CommandStatusPanel`

This would help command and AI entry surfaces feel like one intentional family.

---

### 54. Automation track sections mix multiple reusable patterns that should be formalized together

The automation track shell is a dense editor that combines several repeated mini-patterns:

- `src/modules/Workspace/presentations/views/AutomationView/TrackAutomationSection.tsx`
- related automation lane row and header components

It contains:

- compact track header band
- small mode badge picker
- lane-count readout
- collapsed sparkline rows
- add-lane picker popovers

### Recommendation

Automation should get a small dedicated structural kit:

- `AutomationSectionHeader`
- `AutomationModeBadge`
- `AutomationSparklineRow`
- `AutomationPickerPopover`

This would reduce drift across automation-specific views without forcing them into generic inspector or transport patterns.

---

### 55. The shared component layer is still too thin for the volume of presentation code it is meant to support

One architectural fact stands out from the sweep:

- there are only about `26` shared files under `src/components`
- there are about `247` presentation view/component files under `src/modules/*/presentations`

That ratio helps explain why drift keeps reappearing in module code. The current shared layer is strong on low-level primitives like buttons, sliders, dialogs, and tooltips, but too thin on higher-level DAW and plugin structures.

The most telling shared files here are:

- `src/components/ui/dialog.tsx`
- `src/components/ui/bipolar-slider.tsx`
- `src/components/ui/disabled-feature-wrapper.tsx`

These are useful, but they also show the current ceiling:

- `Dialog` provides a solid outer shell, but not enough interior layout primitives
- `BipolarSlider` proves specialized wrappers are allowed and useful
- `DisabledFeatureWrapper` exists, yet many feature-gate states are still rebuilt locally

### Recommendation

The audit’s primitive list should be treated as a mandate to thicken the shared layer, not just refactor modules. Without a larger shared vocabulary, modules will keep solving the same presentation problems locally.

---

### 56. There is still a legacy plugin-presentation island outside the newer plugin shell language

Most flagship plugin UIs now live inside the newer tactile shell language, but there is still a parallel older presentation island under:

- `src/modules/Plugin/ProofChamber/presentations/views/ProofChamber.tsx`
- `src/modules/Plugin/ProofChamber/presentations/views/SpectrogramView.tsx`

This code uses a more generic card-and-slider dialog style:

- fixed-size bordered panel
- simple top bar and level buttons
- local `KnobControl`
- local spectrogram frame

It is functional, but visually and structurally it sits outside the newer Sourdaw plugin shell approach used elsewhere.

### Recommendation

The audit should treat these legacy plugin views as migration targets:

- move them onto the plugin-shell primitives once those are formalized
- replace local helper controls like `KnobControl` with shared plugin control wrappers
- unify embedded visual framing with the `MiniVizShell` or related primitives

This matters because otherwise the app will continue carrying multiple plugin UI dialects indefinitely.

---

## Immediate Candidates For Design System Expansion

If this were turned into an implementation roadmap, the highest-value additions would be:

1. `daw-toolbar-surface`
2. `daw-context-surface`
3. `DawPanelShell` / `DawSectionHeader`
4. `PluginSectionCard`
5. `PluginMetricTile`
6. `PluginChip`
7. `MiniSlider`
8. `VerticalDrawbar`
9. `StatusTile`
10. `MeterBar`
11. `UtilityPanelShell`
12. `TransportReadout`
13. `InspectorSection`
14. `MiniScrollbar`
15. `EmptyStateCard`
16. `TabRail`
17. `PickerSurface`
18. `ReadoutWell`
19. `DialogSidebar`
20. `SelectionSummaryCard`
21. `DialogShell` / `DialogActionRow`
22. `TransportClusterShell`
23. `PickerSearchRow` / `PickerListItem`
24. `SelectableRow`
25. `ScrollableTabStrip`
26. `WorkspaceHeaderBand`
27. `DialogBand` / `DialogListWell`
28. `DawSelect` / `DawFieldLabel`
29. `InspectorCard` / `InspectorFieldGroup`
30. `UtilityOverlay`
31. `label-micro` / `readout-mono`
32. `MetricCluster`
33. `ChooserCard`
34. `loading-shimmer-inline`
35. `TreeRow` / `GroupedListSection`
36. `ColorSwatchGrid`
37. `DiagramWorkspace`
38. `ActionCluster`
39. `NavCard` / `BrowserListItem`
40. `MiniVizShell`
41. `WelcomeSurface` / `ActionCard`
42. `OverlayIconButton` / `LaneControlStrip`
43. `ChannelStripShell`
44. `MeterShell`
45. `DashboardCard`
46. `StatusBadge` / `TierBadge`
47. `PresenceCursor` / `PresenceTag`
48. `ContextMenuInlineEditor`
49. `CommandSurface`
50. `AutomationSectionHeader` / `AutomationSparklineRow`
51. `FeatureGateCard` via `DisabledFeatureWrapper`
52. `PluginShell` migration targets for legacy plugin views

These additions would absorb a large amount of remaining inline styling without flattening the app’s personality.

---

## Notes On Tone And Restraint

The DAW shell should stay more understated than the flagship plugin panels. That means:

- more neutral surfaces
- less accent saturation
- fewer decorative gradients
- tighter spacing
- more emphasis on hierarchy and tactility than ornament

The plugin suite can stay richer. The DAW frame should feel calmer and more structural.

That distinction should be reflected in the design system itself:

- **DAW primitives** should be calmer and more neutral
- **Plugin primitives** should be more themeable and expressive

---

## Conclusion

The app is no longer missing a design system. It now has one, but it is only partially adopted.

The next UX quality leap is not inventing more visual language. It is **consolidating the language we already have**:

- move repeated DAW chrome into shared utilities and wrappers
- turn recurring plugin shell patterns into actual primitives
- replace raw range inputs with themed variants
- keep dynamic geometry inline, but stop hand-rolling material styling per screen

That will make future UI work faster, more consistent, and much easier to keep inside the visual standards defined in `.agents/specs/look-and-feel.md`.

---

## Coverage Appendix

This expanded audit pass included direct pattern sweeps and representative reads across:

- `src/components/*`
- `src/modules/AiRuntime/presentations`
- `src/modules/Arrangement/presentations`
- `src/modules/AudioEngine/presentations`
- `src/modules/Bacteria/presentations`
- `src/modules/Collaboration/presentations`
- `src/modules/Command/presentations`
- `src/modules/CrdtDocument/presentations`
- `src/modules/Crust/presentations`
- `src/modules/Fermenter/presentations`
- `src/modules/Gluten/presentations`
- `src/modules/Grinder/presentations`
- `src/modules/Levain/presentations`
- `src/modules/Project/presentations`
- `src/modules/Proof/presentations`
- `src/modules/ProofChamber/presentations`
- `src/modules/SampleLibrary/presentations`
- `src/modules/Scoring/presentations`
- `src/modules/Toaster/presentations`
- `src/modules/VirtualKeyboard/presentations`
- `src/modules/Workspace/presentations`
- `src/modules/Yeast/presentations`

Representative files reviewed directly during the broader app-shell passes included:

- `src/modules/Workspace/presentations/views/InspectorPanel.tsx`
- `src/modules/Workspace/presentations/views/MixerPanel.tsx`
- `src/modules/Workspace/presentations/views/SessionView.tsx`
- `src/modules/Workspace/presentations/views/Sidebar.tsx`
- `src/modules/Workspace/presentations/views/PreferencesDialog.tsx`
- `src/modules/Workspace/presentations/views/Transport/TransportControls.tsx`
- `src/modules/Workspace/presentations/views/Transport/PlayheadDisplay.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx`
- `src/modules/AudioEngine/presentations/views/PluginBrowser.tsx`
- `src/modules/AudioEngine/presentations/views/PluginScanSettings.tsx`
- `src/modules/Project/presentations/views/ArrangementSelector.tsx`
- `src/modules/Project/presentations/views/ExportDialog.tsx`
- `src/modules/SampleLibrary/presentations/views/LibraryBrowser.tsx`
- `src/modules/Command/presentations/views/CommandPalette.tsx`
- `src/modules/CrdtDocument/presentations/views/BranchManagerDialog.tsx`
- `src/modules/CrdtDocument/presentations/views/MergeResultDialog.tsx`
- `src/modules/Collaboration/presentations/views/NearbyPanel.tsx`
- `src/modules/AudioEngine/presentations/views/AudioDevicePicker.tsx`
- `src/modules/AudioEngine/presentations/views/MidiDevicePicker.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackAutomationSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/DeviceInspector.tsx`
- `src/modules/Workspace/presentations/views/Inspector/ClipInspector.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackHeaderSection.tsx`
- `src/modules/AiRuntime/presentations/views/AiActionHistoryPanel.tsx`
- `src/modules/AiRuntime/presentations/views/VoiceCommandOverlay.tsx`
- `src/modules/Project/presentations/views/TemplateChooser.tsx`
- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx`
- `src/modules/Workspace/presentations/views/StatusBar.tsx`
- `src/modules/Workspace/presentations/views/RoutingMatrix.tsx`
- `src/modules/Arrangement/presentations/views/TrackListView.tsx`
- `src/modules/Arrangement/presentations/views/TrackContextMenu.tsx`
- `src/modules/SampleLibrary/presentations/components/FolderTree.tsx`
- `src/modules/Workspace/presentations/views/ToolSelector.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/ColorTab.tsx`
- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx`
- `src/modules/Workspace/presentations/views/RoutingGraph.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/SamplesTab.tsx`
- `src/modules/Workspace/presentations/components/Sidebar/InstrumentCard.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/effectsTabHelpers.tsx`
- `src/modules/Workspace/presentations/components/MiniMasterSpectrum.tsx`
- `src/modules/Workspace/presentations/components/LaunchScreen.tsx`
- `src/modules/Workspace/presentations/views/AutomationView/AutomationLaneControls.tsx`
- `src/modules/Workspace/presentations/views/Mixer/ExpandedChannelStrip.tsx`
- `src/modules/Workspace/presentations/views/Metering/LevelMeter.tsx`
- `src/modules/Workspace/presentations/views/AnalysisPanel.tsx`
- `src/modules/Workspace/presentations/views/Prompt/LlmStatusBadge.tsx`
- `src/modules/Collaboration/presentations/views/PresenceOverlay.tsx`
- `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx`
- `src/modules/Command/presentations/views/UndoHistoryPanel.tsx`
- `src/modules/Workspace/presentations/views/PromptBar.tsx`
- `src/modules/Workspace/presentations/views/AutomationView/TrackAutomationSection.tsx`
- `src/modules/Arrangement/presentations/views/TimelineEmptyMenu.tsx`
- `src/modules/Workspace/presentations/views/ClipView/PianoRollToolbar.tsx`
- `src/modules/Plugin/ProofChamber/presentations/views/ProofChamber.tsx`
- `src/modules/Plugin/ProofChamber/presentations/views/SpectrogramView.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/bipolar-slider.tsx`
- `src/components/ui/disabled-feature-wrapper.tsx`

### Module Inventory Snapshot

Presentation view/component files found during the sweep by module:

- `AiRuntime`: `9`
- `Arrangement`: `17`
- `AudioEngine`: `4`
- `Bacteria`: `13`
- `Collaboration`: `4`
- `Command`: `2`
- `CrdtDocument`: `2`
- `Crust`: `6`
- `Fermenter`: `24`
- `Gluten`: `4`
- `Grinder`: `1`
- `Levain`: `7`
- `Plugin`: `2`
- `Project`: `4`
- `Proof`: `9`
- `ProofChamber`: `4`
- `SampleLibrary`: `4`
- `Scoring`: `1`
- `Toaster`: `4`
- `VirtualKeyboard`: `1`
- `Workspace`: `121`
- `Yeast`: `4`

This snapshot is useful because it explains where most design-system drift lives: the shared component layer is relatively small, while `Workspace`, plugin views, and surrounding utility modules carry most of the presentation volume.

This file should be treated as a living audit. As the design system grows, each major primitive family above should get checked off by replacing examples in at least one DAW shell and one plugin shell before being considered “real.”
