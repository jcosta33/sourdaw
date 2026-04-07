---
name: component-test-coverage
scope: src/components, **/presentations/components
updated: 2026-04-07
---

# Audit: component unit test coverage

## Goal

Every React component under `src/components/` and every `**/presentations/components/**` module has a co-located unit test file (`*.spec.tsx` for components, `*.spec.ts` for non-TSX presentation helpers such as constants). Tests assert user-visible behavior and interactions; **incorrect behavior is fixed in source before a test locks it in.**

Target: **100% file-level coverage** of those files (checklist). **Measured** line/branch coverage: `pnpm test:coverage`.

## Current state

- **Inventory:** 204 files (see checklist below).
- **Coverage tooling:** `pnpm test:coverage` (v8 via `@vitest/coverage-v8`); reports in `./coverage/` (HTML, `lcov`, JSON). Config: `vite.config.ts` → `test.coverage`.

## Progress summary

| Area | Files | Has spec |
|------|------:|---------:|
| `src/components/ui/` | 12 | 12 |
| `src/components/daw/` (incl. visualizers + `colorPresets.ts`) | 69 | 69 |
| `src/modules/*/presentations/components/` | 123 | 123 |
| **Total** | **204** | **204** |

## Findings

1. **Inventory:** All 204 checklist files have co-located specs (see checkboxes below). Measured line/branch coverage: `pnpm test:coverage`.
2. **Radix / canvas / WebGL:** Some components need providers, resize observers, or canvas mocks — keep tests shallow; mock only module boundaries per `docs/06-testing.md`.
3. **jsdom gaps:** Radix Slider/Tooltip use `ResizeObserver` — polyfilled in `src/setupTests.ts` for all tests.
4. **Radix Tooltip + disabled UX:** Putting `aria-disabled` on `TooltipTrigger` prevented tooltips from opening; `DisabledFeatureWrapper` now uses native `disabled` on the child (via `cloneElement`) and wraps with `TooltipProvider` so Radix contract is satisfied.
5. **Slider a11y:** `aria-label` / `aria-labelledby` on `Slider` root did not apply to the element with `role="slider"` (the thumb). Labels are forwarded to each `SliderPrimitive.Thumb`.
6. **Tooltip tests in jsdom:** Synthetic hover does not reliably open Radix tooltips; `disabled-feature-wrapper.spec.tsx` stubs `#/components/ui/tooltip` to assert `reason` wiring without depending on Radix hover timing.

## Resolved (2026-04-07)

| Issue | Fix |
|-------|-----|
| `DragResizeHandle` used `React.MouseEvent` without namespace import | Import `MouseEvent` from `react`. |
| `CardTitle` ref type did not match `<h3>` | `Ref<HTMLHeadingElement>`. |
| `DisabledFeatureWrapper` missing `TooltipProvider` | Wrap disabled branch in `TooltipProvider`. |
| Tooltip blocked when trigger had `aria-disabled` | Use `cloneElement` to set `disabled` on child; remove `aria-disabled` from wrapper span. |

## Priorities

1. Raise measured line/branch coverage where it matters (use `./coverage/index.html` after `pnpm test:coverage`).

## Inventory (checkbox = co-located spec exists)

- [x] `src/components/daw/DawAnalysisCard.tsx`
- [x] `src/components/daw/DawBlockedState.tsx`
- [x] `src/components/daw/DawChannelStripShell.tsx`
- [x] `src/components/daw/DawChooserCard.tsx`
- [x] `src/components/daw/DawCompactCheckbox.tsx`
- [x] `src/components/daw/DawCompactInput.tsx`
- [x] `src/components/daw/DawCompactSelect.tsx`
- [x] `src/components/daw/DawCompactTextarea.tsx`
- [x] `src/components/daw/DawContextMenuSurface.tsx`
- [x] `src/components/daw/DawControlStrip.tsx`
- [x] `src/components/daw/DawDiagramFrame.tsx`
- [x] `src/components/daw/DawDialogBody.tsx`
- [x] `src/components/daw/DawDialogFooter.tsx`
- [x] `src/components/daw/DawDialogSection.tsx`
- [x] `src/components/daw/DawDisplaySurface.tsx`
- [x] `src/components/daw/DawEmptyState.tsx`
- [x] `src/components/daw/DawEyebrowLabel.tsx`
- [x] `src/components/daw/DawGridHeaderCell.tsx`
- [x] `src/components/daw/DawHeaderBand.tsx`
- [x] `src/components/daw/DawHierarchyRow.tsx`
- [x] `src/components/daw/DawInlineHint.tsx`
- [x] `src/components/daw/DawKeycap.tsx`
- [x] `src/components/daw/DawMenuInlineEditor.tsx`
- [x] `src/components/daw/DawMenuParts.tsx`
- [x] `src/components/daw/DawMeterBar.tsx`
- [x] `src/components/daw/DawMeterFrame.tsx`
- [x] `src/components/daw/DawMetricCluster.tsx`
- [x] `src/components/daw/DawMicroBadge.tsx`
- [x] `src/components/daw/DawMiniSectionHeader.tsx`
- [x] `src/components/daw/DawPanelSurface.tsx`
- [x] `src/components/daw/DawPickerCard.tsx`
- [x] `src/components/daw/DawPickerRow.tsx`
- [x] `src/components/daw/DawPluginChip.tsx`
- [x] `src/components/daw/DawPluginChoiceRow.tsx`
- [x] `src/components/daw/DawPluginInsetCard.tsx`
- [x] `src/components/daw/DawPluginLed.tsx`
- [x] `src/components/daw/DawPluginMetricStrip.tsx`
- [x] `src/components/daw/DawPluginMetricTile.tsx`
- [x] `src/components/daw/DawPluginRail.tsx`
- [x] `src/components/daw/DawPluginReadoutList.tsx`
- [x] `src/components/daw/DawPluginSectionCard.tsx`
- [x] `src/components/daw/DawPluginSectionHeader.tsx`
- [x] `src/components/daw/DawPluginToggle.tsx`
- [x] `src/components/daw/DawReadoutRow.tsx`
- [x] `src/components/daw/DawSectionDivider.tsx`
- [x] `src/components/daw/DawSideRail.tsx`
- [x] `src/components/daw/DawStatusDot.tsx`
- [x] `src/components/daw/DawSwatchButton.tsx`
- [x] `src/components/daw/DawTransportCluster.tsx`
- [x] `src/components/daw/DawUtilityListRow.tsx`
- [x] `src/components/daw/DawUtilityMetric.tsx`
- [x] `src/components/daw/DawUtilityNotice.tsx`
- [x] `src/components/daw/DawUtilityPanel.tsx`
- [x] `src/components/daw/DawUtilitySection.tsx`
- [x] `src/components/daw/Fader.tsx`
- [x] `src/components/daw/LED.tsx`
- [x] `src/components/daw/LatchButton.tsx`
- [x] `src/components/daw/MechanicalSwitch.tsx`
- [x] `src/components/daw/RotaryKnob.tsx`
- [x] `src/components/daw/ValueField.tsx`
- [x] `src/components/daw/colorPresets.ts`
- [x] `src/components/daw/visualizers/ADSREnvelope.tsx`
- [x] `src/components/daw/visualizers/CompressorCurve.tsx`
- [x] `src/components/daw/visualizers/DelayTaps.tsx`
- [x] `src/components/daw/visualizers/DistortionCurve.tsx`
- [x] `src/components/daw/visualizers/EQCurve.tsx`
- [x] `src/components/daw/visualizers/FilterResponse.tsx`
- [x] `src/components/daw/visualizers/OscillatorWaveform.tsx`
- [x] `src/components/daw/visualizers/ReverbDecay.tsx`
- [x] `src/components/ui/DragResizeHandle.tsx`
- [x] `src/components/ui/bipolar-slider.tsx`
- [x] `src/components/ui/button.tsx`
- [x] `src/components/ui/card.tsx`
- [x] `src/components/ui/dialog.tsx`
- [x] `src/components/ui/disabled-feature-wrapper.tsx`
- [x] `src/components/ui/dropdown-menu.tsx`
- [x] `src/components/ui/input.tsx`
- [x] `src/components/ui/scroll-area.tsx`
- [x] `src/components/ui/separator.tsx`
- [x] `src/components/ui/slider.tsx`
- [x] `src/components/ui/tooltip.tsx`
- [x] `src/modules/AiRuntime/presentations/components/AiTaskResultCard.tsx`
- [x] `src/modules/AiRuntime/presentations/components/ChatComposer.tsx`
- [x] `src/modules/AiRuntime/presentations/components/GenerativeParamGrids.tsx`
- [x] `src/modules/AiRuntime/presentations/components/mixAnalysis/MixAnalysisSections.tsx`
- [x] `src/modules/Bacteria/presentations/components/BandStrip.tsx`
- [x] `src/modules/Bacteria/presentations/components/BezierLfoEditor.tsx`
- [x] `src/modules/Bacteria/presentations/components/CrossoverDisplay.tsx`
- [x] `src/modules/Bacteria/presentations/components/ModulationDock.tsx`
- [x] `src/modules/Bacteria/presentations/components/NodeGraphEditor.tsx`
- [x] `src/modules/Bacteria/presentations/components/SpectralBinEditor.tsx`
- [x] `src/modules/Bacteria/presentations/components/SpectrumAnalyzer.tsx`
- [x] `src/modules/Bacteria/presentations/components/StepSequencerEditor.tsx`
- [x] `src/modules/Bacteria/presentations/components/WaveshaperEditor.tsx`
- [x] `src/modules/Bacteria/presentations/components/XYMorphPad.tsx`
- [x] `src/modules/Collaboration/presentations/components/CollaborationBlock.tsx`
- [x] `src/modules/Collaboration/presentations/components/CollaborationStatusRow.tsx`
- [x] `src/modules/Collaboration/presentations/components/InviteCodeRow.tsx`
- [x] `src/modules/Collaboration/presentations/components/PeerPresenceRow.tsx`
- [x] `src/modules/Collaboration/presentations/components/PresenceLabel.tsx`
- [x] `src/modules/Collaboration/presentations/components/PresenceMarker.tsx`
- [x] `src/modules/Crust/presentations/components/CrustControlZone.tsx`
- [x] `src/modules/Crust/presentations/components/CrustGainStrip.tsx`
- [x] `src/modules/Crust/presentations/components/CrustMeteringStrip.tsx`
- [x] `src/modules/Crust/presentations/components/CrustSatCurve.tsx`
- [x] `src/modules/Crust/presentations/components/CrustWaveformDisplay.tsx`
- [x] `src/modules/Fermenter/presentations/components/AdditiveSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/EffectsSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/EnvelopeSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/FilterSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/FmSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/GranularSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/KarplusSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/LayerStack.tsx`
- [x] `src/modules/Fermenter/presentations/components/LfoSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/MacroStrip.tsx`
- [x] `src/modules/Fermenter/presentations/components/ModulationSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/OscillatorSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/Oscilloscope.tsx`
- [x] `src/modules/Fermenter/presentations/components/OutputMeter.tsx`
- [x] `src/modules/Fermenter/presentations/components/PresetBrowser.tsx`
- [x] `src/modules/Fermenter/presentations/components/SamplerSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/SectionNav.tsx`
- [x] `src/modules/Fermenter/presentations/components/SignalFlowView.tsx`
- [x] `src/modules/Fermenter/presentations/components/SpectrumAnalyzer.tsx`
- [x] `src/modules/Fermenter/presentations/components/UnisonSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/WarpSection.tsx`
- [x] `src/modules/Fermenter/presentations/components/XYPad.tsx`
- [x] `src/modules/Gluten/presentations/components/GlutenCurve.tsx`
- [x] `src/modules/Gluten/presentations/components/GrHistory.tsx`
- [x] `src/modules/Gluten/presentations/components/GrMeter.tsx`
- [x] `src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx`
- [x] `src/modules/GrandBoule/presentations/components/MorphPanel.tsx`
- [x] `src/modules/GrandBoule/presentations/components/PerNoteEditor.tsx`
- [x] `src/modules/GrandBoule/presentations/components/PianoKeyboard.tsx`
- [x] `src/modules/GrandBoule/presentations/components/PianoModel3D.tsx`
- [x] `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx`
- [x] `src/modules/GrandBoule/presentations/components/StringVibrationView.tsx`
- [x] `src/modules/Levain/presentations/components/ArticulationList.tsx`
- [x] `src/modules/Levain/presentations/components/ExpressionPanel.tsx`
- [x] `src/modules/Levain/presentations/components/HumanizePanel.tsx`
- [x] `src/modules/Levain/presentations/components/LegatoTuning.tsx`
- [x] `src/modules/Levain/presentations/components/LevainMacroStrip.tsx`
- [x] `src/modules/Levain/presentations/components/MicBlendSlider.tsx`
- [x] `src/modules/Proof/presentations/components/LoudnessHistory.tsx`
- [x] `src/modules/Proof/presentations/components/ProofDynSection.tsx`
- [x] `src/modules/Proof/presentations/components/ProofEqCurve.tsx`
- [x] `src/modules/Proof/presentations/components/ProofEqSection.tsx`
- [x] `src/modules/Proof/presentations/components/ProofExciterSection.tsx`
- [x] `src/modules/Proof/presentations/components/ProofImagerSection.tsx`
- [x] `src/modules/Proof/presentations/components/ProofLimiterSection.tsx`
- [x] `src/modules/Proof/presentations/components/TonalBalance.tsx`
- [x] `src/modules/ProofChamber/presentations/components/DecayEqOverlay.tsx`
- [x] `src/modules/ProofChamber/presentations/components/IrBrowser.tsx`
- [x] `src/modules/ProofChamber/presentations/components/SignalFlowDiagram.tsx`
- [x] `src/modules/SampleLibrary/presentations/components/FolderTree.tsx`
- [x] `src/modules/SampleLibrary/presentations/components/LibraryRootCard.tsx`
- [x] `src/modules/SampleLibrary/presentations/components/SampleRow.tsx`
- [x] `src/modules/Sampler/presentations/components/PadGrid.tsx`
- [x] `src/modules/Sampler/presentations/components/SamplerControls.tsx`
- [x] `src/modules/Sampler/presentations/components/SliceOverlay.tsx`
- [x] `src/modules/Sampler/presentations/components/WaveformDisplay.tsx`
- [x] `src/modules/Toaster/presentations/components/PadGrid.tsx`
- [x] `src/modules/Toaster/presentations/components/PadMixer.tsx`
- [x] `src/modules/Toaster/presentations/components/StepSequencer.tsx`
- [x] `src/modules/Workspace/presentations/components/AlphaNoticeDialog.tsx`
- [x] `src/modules/Workspace/presentations/components/CaptureKeyButton.tsx`
- [x] `src/modules/Workspace/presentations/components/ErrorBoundary.tsx`
- [x] `src/modules/Workspace/presentations/components/Inspector/ChoiceCard.tsx`
- [x] `src/modules/Workspace/presentations/components/Inspector/ControlHeader.tsx`
- [x] `src/modules/Workspace/presentations/components/Inspector/InsetPanel.tsx`
- [x] `src/modules/Workspace/presentations/components/Inspector/InspectorDetailHeader.tsx`
- [x] `src/modules/Workspace/presentations/components/Inspector/MetaText.tsx`
- [x] `src/modules/Workspace/presentations/components/Inspector/SurfaceCard.tsx`
- [x] `src/modules/Workspace/presentations/components/InstrumentBottomPanel.tsx`
- [x] `src/modules/Workspace/presentations/components/LaunchScreen.tsx`
- [x] `src/modules/Workspace/presentations/components/Mixer/MixerInsetButton.tsx`
- [x] `src/modules/Workspace/presentations/components/Mixer/MixerMicroReadout.tsx`
- [x] `src/modules/Workspace/presentations/components/Mixer/MixerSection.tsx`
- [x] `src/modules/Workspace/presentations/components/Mixer/MixerStripValue.tsx`
- [x] `src/modules/Workspace/presentations/components/MobileGate.tsx`
- [x] `src/modules/Workspace/presentations/components/ModulationLFO.tsx`
- [x] `src/modules/Workspace/presentations/components/NotificationToast.tsx`
- [x] `src/modules/Workspace/presentations/components/ProjectLoadingOverlay.tsx`
- [x] `src/modules/Workspace/presentations/components/ResizeHandle.tsx`
- [x] `src/modules/Workspace/presentations/components/ShortcutCheatSheet.tsx`
- [x] `src/modules/Workspace/presentations/components/Sidebar/EmptyState.tsx`
- [x] `src/modules/Workspace/presentations/components/Sidebar/InstrumentCard.tsx`
- [x] `src/modules/Workspace/presentations/components/Sidebar/PresetItem.tsx`
- [x] `src/modules/Workspace/presentations/components/Sidebar/PreviewButton.tsx`
- [x] `src/modules/Workspace/presentations/components/Sidebar/RailBackBar.tsx`
- [x] `src/modules/Workspace/presentations/components/Sidebar/RailTabBar.tsx`
- [x] `src/modules/Workspace/presentations/components/Sidebar/SearchSummary.tsx`
- [x] `src/modules/Workspace/presentations/components/Sidebar/SectionHeader.tsx`
- [x] `src/modules/Workspace/presentations/components/Sidebar/sidebarConstants.ts`
- [x] `src/modules/Workspace/presentations/components/SourdawLogo.tsx`
- [x] `src/modules/Workspace/presentations/components/SpatialPanner.tsx`
- [x] `src/modules/Workspace/presentations/components/Transport/TransportSegmentedReadout.tsx`
- [x] `src/modules/Workspace/presentations/components/Transport/TransportValuePill.tsx`
- [x] `src/modules/Workspace/presentations/components/Transport/VoiceButton.tsx`
- [x] `src/modules/Workspace/presentations/components/Wavetable3D.tsx`
- [x] `src/modules/Yeast/presentations/components/KeyboardSplit.tsx`
- [x] `src/modules/Yeast/presentations/components/ProcessorParams.tsx`
- [x] `src/modules/Yeast/presentations/components/StepPatternEditor.tsx`
