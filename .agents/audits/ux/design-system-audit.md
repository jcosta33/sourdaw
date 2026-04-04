# UX Design System Audit

## Scope

This file now tracks only unresolved presentation-layer issues.

Addressed families and landed primitives were intentionally removed to keep the audit actionable. Dynamic geometry can still stay inline; the remaining issues are repeated material, chrome, layout, and interaction patterns that still need better shared structure.

The unresolved work still needs to respect `.agents/specs/look-and-feel.md`:

- understated DAW shell
- tactile, premium, vector-first surfaces
- calm hierarchy
- stronger plugin flair where appropriate

## Current Priorities

1. DAW readout, meter, and utility-surface cleanup
2. Remaining plugin chip, rail, and quick-read specialization
3. Browser, chooser, and row/card grammar
4. Form/control families still using raw HTML or one-off styling

## Open Issues

### 1. DAW header and shell stragglers still exist

Open issue:
- A few view-local toolbar and panel-chrome variants still sit outside the shared DAW shell language.

Representative files:
- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx`
- `src/modules/Workspace/presentations/views/ArrangeView.tsx`
- `src/modules/Workspace/presentations/views/SessionView.tsx`
- `src/modules/Workspace/presentations/views/MixerPanel.tsx`

Needed:
- finish the last restrained DAW header/panel-shell variants without making the shell louder

### 2. Floating menus and context surfaces are not fully unified repo-wide

Open issue:
- Many DAW-facing menus are aligned, but repo-wide floating surfaces still drift once inline states or custom interiors appear.

Representative files:
- `src/modules/Arrangement/presentations/views/TrackContextMenu.tsx`
- `src/modules/Arrangement/presentations/views/TimelineEmptyMenu.tsx`
- `src/modules/Workspace/presentations/views/AutomationView/AutomationContextMenu.tsx`
- `src/modules/Workspace/presentations/views/ClipView/PianoRollContextMenu.tsx`

Needed:
- finish the remaining menu/popup surfaces
- formalize patterns for menus that contain inline editors or utility states

### 3. Compact readout and meter clusters are still duplicated inline

Open issue:
- Status, transport, mixer, and analysis surfaces still compose too many small readout/meter clusters by hand.

Representative files:
- `src/modules/Workspace/presentations/views/StatusBar.tsx`
- `src/modules/Workspace/presentations/views/Transport/TransportControls.tsx`
- `src/modules/Workspace/presentations/views/Transport/PanelToggles.tsx`
- `src/modules/Workspace/presentations/views/Mixer/ExpandedChannelStrip.tsx`
- `src/modules/AiRuntime/presentations/components/mixAnalysis/MixAnalysisSections.tsx`

Needed:
- tighter neutral metric-cluster composition
- less local assembly of labels, bars, and mono values

### 4. Transport micro-shells are still too bespoke

Open issue:
- Transport is better than it was, but the remaining micro-clusters still style themselves too independently.

Representative files:
- `src/modules/Workspace/presentations/views/Transport/TransportControls.tsx`
- `src/modules/Workspace/presentations/views/Transport/PanelToggles.tsx`
- `src/modules/Workspace/presentations/views/Transport/UndoRedoButtons.tsx`
- `src/modules/Workspace/presentations/views/Transport/SoloModeSelector.tsx`

Needed:
- complete the transport-side cluster family
- keep the bar restrained while reducing one-off wells and captions

### 5. Utility-panel interiors still duplicate local grammar

Open issue:
- The shells are mostly aligned, but list wells, summary rows, and result blocks still repeat inside utility panels.

Representative files:
- `src/modules/AiRuntime/presentations/views/AiActionHistoryPanel.tsx`
- `src/modules/AiRuntime/presentations/views/MixAnalysisPanel.tsx`
- `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx`
- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx`
- `src/modules/Command/presentations/views/UndoHistoryPanel.tsx`

Needed:
- shared interior list/result grammar for utility overlays

### 6. Dialog interiors are still inconsistent

Open issue:
- Dialog shell work landed, but richer dialog interior structure is still inconsistent.

Representative files:
- `src/modules/Workspace/presentations/views/PreferencesDialog.tsx`
- `src/modules/Project/presentations/views/ExportDialog.tsx`
- `src/modules/Workspace/presentations/views/Mixer/MixHealthDialog.tsx`

Needed:
- calmer shared modal interior language
- reusable interior/action-row kit

### 7. Empty, blocked, and selection-summary content is still fragmented

Open issue:
- Empty-state styling is much better, but richer selection-required and summary content is still inconsistent.

Representative files:
- `src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx`
- `src/modules/Workspace/presentations/views/MixerPanel.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx`
- `src/modules/SampleLibrary/presentations/views/LibraryBrowser.tsx`
- `src/modules/Collaboration/presentations/views/NearbyPanel.tsx`

Needed:
- selection-summary and blocked-state content components, not just style reuse

### 8. Sidebar rails, tabs, and overflow navigation are still only partly normalized

Open issue:
- Sidebar and rail navigation patterns still diverge in layout, overflow handling, and row grammar.

Representative files:
- `src/modules/Workspace/presentations/views/Sidebar/Sidebar.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/InstrumentsTab.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/ColorTab.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/StageTab.tsx`

Needed:
- consistent rail/nav-item treatment
- better standardization for overflow tab scrollers

### 9. Picker, browser, and chooser surfaces still lack a shared grammar

Open issue:
- Browser/picker UIs are proliferating with inconsistent search, row, and empty-state behavior.

Representative files:
- `src/modules/AudioEngine/presentations/views/PluginBrowser.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/OnlineSampleBrowser.tsx`
- `src/modules/AiRuntime/presentations/views/PatternBrowser.tsx`
- `src/modules/Project/presentations/views/ArrangementSelector.tsx`

Needed:
- shared picker surface and row/card grammar

### 10. List rows and tree/grouped-item patterns are still repeating

Open issue:
- Selectable rows, grouped browser items, and tree-like structures still repeat local styling and state handling.

Representative files:
- `src/modules/Arrangement/presentations/views/TrackListView.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/InstrumentsTab.tsx`
- `src/modules/Workspace/presentations/views/Sidebar/SamplesTab.tsx`
- `src/modules/Collaboration/presentations/views/NearbyPanel.tsx`

Needed:
- reusable row/card primitive for dense selectable items

### 11. The compact DAW form kit is still incomplete

Open issue:
- Selects improved, but small inputs, inline editors, and a few raw controls still drift.

Representative files:
- `src/modules/Project/presentations/views/ArrangementSelector.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackHeaderSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/ClipInspector.tsx`
- `src/modules/Workspace/presentations/views/TempoEditor.tsx`

Needed:
- broader DAW form kit beyond compact selects

### 12. Raw `input[type="range"]` still appears in presentation code

Open issue:
- A few flows still use raw range sliders instead of system controls or a thin themed wrapper.

Representative files:
- `src/modules/AiRuntime/presentations/views/PatternBrowser.tsx`
- `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx`
- other remaining presentation-side range controls

Needed:
- finish migrating or wrap them intentionally

### 13. Inspector card/well structure is still too local

Open issue:
- Inspector helpers exist, but the broader card/well family is still module-local and visually inconsistent.

Representative files:
- `src/modules/Workspace/presentations/views/Inspector/ClipInspector.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackLevelSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/TrackRoutingSection.tsx`
- `src/modules/Workspace/presentations/views/Inspector/DeviceInspector.tsx`

Needed:
- decide what stays inspector-local
- decide what deserves promotion into shared DAW primitives

### 14. Mixer internals still repeat a distinct sub-language

Open issue:
- Mixer popups and some shells improved, but strip-side readouts, labels, and utility sections still repeat.

Representative files:
- `src/modules/Workspace/presentations/views/Mixer/ExpandedChannelStrip.tsx`
- `src/modules/Workspace/presentations/views/Mixer/DeviceChainSection.tsx`
- `src/modules/Workspace/presentations/views/Mixer/SendsSection.tsx`
- `src/modules/Workspace/presentations/views/Mixer/IOSection.tsx`

Needed:
- formalize the remaining channel-strip micro-language

### 15. Metering and analysis wrappers still need a stronger shared language

Open issue:
- Rendering can stay custom, but wrapper, labeling, and small supporting chrome still drift.

Representative files:
- `src/modules/Workspace/presentations/views/Metering/LUFSMeter.tsx`
- `src/modules/AiRuntime/presentations/components/mixAnalysis/MixAnalysisSections.tsx`
- `src/modules/Workspace/presentations/views/AnalysisPanel.tsx`

Needed:
- shared metering wrapper/labeling language
- analysis “instrument panel” card consistency

### 16. Plugin chip, toggle, and LED-like status families are still only partly unified

Open issue:
- Shared plugin chip, toggle, and LED primitives now exist, but several plugin-local variants still remain outside the family.

Representative files:
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx`
- `src/modules/Levain/presentations/components/LegatoTuning.tsx`
- `src/modules/Levain/presentations/components/ExpressionPanel.tsx`
- `src/modules/Fermenter/presentations/views/FermenterPanel.tsx`
- `src/modules/Toaster/presentations/views/ToasterPanel.tsx`

Needed:
- finish migrating the remaining plugin-local chip variants
- keep plugin status/readiness indicators on the shared LED language

### 17. Plugin rail/readout variants still have specialized local treatments

Open issue:
- Base plugin cards and rows are shared now, but some richer right-rail and diagnostic variants still need their own shared refinement.

Representative files:
- `src/modules/Proof/presentations/views/ProofPanel.tsx`
- `src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx`

Needed:
- optional plugin rail/readout variant layer on top of the shared base primitives

### 18. Crust remains a legacy control-styling island

Open issue:
- `Crust` still contains a lot of pre-system control language and should be treated as a focused cleanup target.

Representative files:
- `src/modules/Crust/presentations/views/CrustPanel.tsx`
- `src/modules/Crust/presentations/components/CrustControlZone.tsx`
- `src/modules/Crust/presentations/components/CrustMeteringStrip.tsx`

Needed:
- migrate legacy control styling onto the newer shared plugin language

### 19. Virtual Keyboard remains heavily bespoke

Open issue:
- It is visually strong, but still largely outside the shared system.

Representative files:
- `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboardPanel.tsx`
- related presentation components

Needed:
- shared framing around the custom key rendering

### 20. Collaboration-specific overlay grammar is still missing

Open issue:
- Presence, nearby, and invite overlays still need a more coherent shared overlay language.

Representative files:
- `src/modules/Collaboration/presentations/views/NearbyPanel.tsx`
- `src/modules/Collaboration/presentations/views/CollaborationPanel.tsx`
- `src/modules/Collaboration/presentations/views/QrInvite.tsx`

Needed:
- collaboration-specific overlay/presence grammar

### 21. Diagram, graph, and matrix workspaces still need chrome primitives

Open issue:
- Diagram/editor workspaces still carry local shell logic and framing.

Representative files:
- `src/modules/Workspace/presentations/views/RoutingGraph.tsx`
- graph and matrix-like editors elsewhere in presentations

Needed:
- shared diagram-editor chrome layer

### 22. Color/swatch and chooser-card families are still local

Open issue:
- Swatch selection and chooser-card patterns are repeated but not formalized.

Representative files:
- `src/modules/Workspace/presentations/views/Sidebar/ColorTab.tsx`
- chooser-heavy picker/browser flows across presentations

Needed:
- swatch grid and chooser-card primitives

### 23. Several module-local helpers are still proto-primitives

Open issue:
- Some helpers are still only local even though the pattern may be broader than one module.

Representative files:
- inspector-local helpers under `src/modules/Workspace/presentations/components/Inspector`
- sidebar-local helpers
- plugin-local helper islands that still repeat beyond one module

Needed:
- continued evaluation of which helpers should stay local and which should be promoted intentionally

### 24. There is still a legacy plugin-presentation island

Open issue:
- One older plugin presentation surface still sits outside the newer plugin-shell language.

Representative files:
- `src/modules/Plugin/ProofChamber/presentations/views/ProofChamber.tsx`
- `src/modules/Plugin/ProofChamber/presentations/views/SpectrogramView.tsx`

Needed:
- bring the legacy island up to the current plugin-shell standard
