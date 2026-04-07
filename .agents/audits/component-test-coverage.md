---
name: component-test-coverage
scope: src/components, **/presentations/components
updated: 2026-04-07
---

# Audit: component unit test coverage

## Goal

Every React component under `src/components/` and every `**/presentations/components/**` module has a co-located unit test file (`*.spec.tsx` for components, `*.spec.ts` for non-TSX presentation helpers such as constants). Tests assert user-visible behavior and interactions; **incorrect behavior is fixed in source before a test locks it in.**

Target: **100% coverage** of those files (enable `@vitest/coverage-v8` or equivalent when project owners add the dependency — not added in this session).

## Current state

- **Inventory:** 204 files (see checklist below).
- **Coverage tooling:** not configured in `package.json` / Vitest yet; use `pnpm test --run` for green builds until coverage is wired.

## Progress summary

| Area | Files | Has spec |
|------|------:|---------:|
| `src/components/ui/` | 12 | 12 |
| `src/components/daw/` (incl. visualizers + `colorPresets.ts`) | 69 | 69 |
| `src/modules/*/presentations/components/` | 123 | 35 (Workspace `*.tsx` complete; `sidebarConstants.ts` pending) |
| **Total** | **204** | **116** |

## Findings

1. **Scale:** Full coverage is a multi-session effort; progress is tracked by updating checkboxes and the summary table in this file.
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

1. `src/modules/*/presentations/components/` (~123 files) — add co-located specs module-by-module.
2. Wire Vitest coverage (`@vitest/coverage-v8`) when approved, then drive toward 100% measured coverage.

## Inventory (checkbox = co-located spec exists)

- [ ] `src/components/daw/DawAnalysisCard.tsx`
- [ ] `src/components/daw/DawBlockedState.tsx`
- [ ] `src/components/daw/DawChannelStripShell.tsx`
- [ ] `src/components/daw/DawChooserCard.tsx`
- [ ] `src/components/daw/DawCompactCheckbox.tsx`
- [ ] `src/components/daw/DawCompactInput.tsx`
- [ ] `src/components/daw/DawCompactSelect.tsx`
- [ ] `src/components/daw/DawCompactTextarea.tsx`
- [ ] `src/components/daw/DawContextMenuSurface.tsx`
- [ ] `src/components/daw/DawControlStrip.tsx`
- [ ] `src/components/daw/DawDiagramFrame.tsx`
- [ ] `src/components/daw/DawDialogBody.tsx`
- [ ] `src/components/daw/DawDialogFooter.tsx`
- [ ] `src/components/daw/DawDialogSection.tsx`
- [ ] `src/components/daw/DawDisplaySurface.tsx`
- [ ] `src/components/daw/DawEmptyState.tsx`
- [ ] `src/components/daw/DawEyebrowLabel.tsx`
- [ ] `src/components/daw/DawGridHeaderCell.tsx`
- [ ] `src/components/daw/DawHeaderBand.tsx`
- [ ] `src/components/daw/DawHierarchyRow.tsx`
- [ ] `src/components/daw/DawInlineHint.tsx`
- [ ] `src/components/daw/DawKeycap.tsx`
- [ ] `src/components/daw/DawMenuInlineEditor.tsx`
- [ ] `src/components/daw/DawMenuParts.tsx`
- [ ] `src/components/daw/DawMeterBar.tsx`
- [ ] `src/components/daw/DawMeterFrame.tsx`
- [ ] `src/components/daw/DawMetricCluster.tsx`
- [ ] `src/components/daw/DawMicroBadge.tsx`
- [ ] `src/components/daw/DawMiniSectionHeader.tsx`
- [ ] `src/components/daw/DawPanelSurface.tsx`
- [ ] `src/components/daw/DawPickerCard.tsx`
- [ ] `src/components/daw/DawPickerRow.tsx`
- [ ] `src/components/daw/DawPluginChip.tsx`
- [ ] `src/components/daw/DawPluginChoiceRow.tsx`
- [ ] `src/components/daw/DawPluginInsetCard.tsx`
- [ ] `src/components/daw/DawPluginLed.tsx`
- [ ] `src/components/daw/DawPluginMetricStrip.tsx`
- [ ] `src/components/daw/DawPluginMetricTile.tsx`
- [ ] `src/components/daw/DawPluginRail.tsx`
- [ ] `src/components/daw/DawPluginReadoutList.tsx`
- [ ] `src/components/daw/DawPluginSectionCard.tsx`
- [ ] `src/components/daw/DawPluginSectionHeader.tsx`
- [ ] `src/components/daw/DawPluginToggle.tsx`
- [ ] `src/components/daw/DawReadoutRow.tsx`
- [ ] `src/components/daw/DawSectionDivider.tsx`
- [ ] `src/components/daw/DawSideRail.tsx`
- [ ] `src/components/daw/DawStatusDot.tsx`
- [ ] `src/components/daw/DawSwatchButton.tsx`
- [ ] `src/components/daw/DawTransportCluster.tsx`
- [ ] `src/components/daw/DawUtilityListRow.tsx`
- [ ] `src/components/daw/DawUtilityMetric.tsx`
- [ ] `src/components/daw/DawUtilityNotice.tsx`
- [ ] `src/components/daw/DawUtilityPanel.tsx`
- [ ] `src/components/daw/DawUtilitySection.tsx`
- [ ] `src/components/daw/Fader.tsx`
- [ ] `src/components/daw/LED.tsx`
- [ ] `src/components/daw/LatchButton.tsx`
- [ ] `src/components/daw/MechanicalSwitch.tsx`
- [ ] `src/components/daw/RotaryKnob.tsx`
- [ ] `src/components/daw/ValueField.tsx`
- [ ] `src/components/daw/colorPresets.ts`
- [ ] `src/components/daw/visualizers/ADSREnvelope.tsx`
- [ ] `src/components/daw/visualizers/CompressorCurve.tsx`
- [ ] `src/components/daw/visualizers/DelayTaps.tsx`
- [ ] `src/components/daw/visualizers/DistortionCurve.tsx`
- [ ] `src/components/daw/visualizers/EQCurve.tsx`
- [ ] `src/components/daw/visualizers/FilterResponse.tsx`
- [ ] `src/components/daw/visualizers/OscillatorWaveform.tsx`
- [ ] `src/components/daw/visualizers/ReverbDecay.tsx`
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
- [ ] `src/modules/AiRuntime/presentations/components/AiTaskResultCard.tsx`
- [ ] `src/modules/AiRuntime/presentations/components/ChatComposer.tsx`
- [ ] `src/modules/AiRuntime/presentations/components/GenerativeParamGrids.tsx`
- [ ] `src/modules/AiRuntime/presentations/components/mixAnalysis/MixAnalysisSections.tsx`
- [ ] `src/modules/Bacteria/presentations/components/BandStrip.tsx`
- [ ] `src/modules/Bacteria/presentations/components/BezierLfoEditor.tsx`
- [ ] `src/modules/Bacteria/presentations/components/CrossoverDisplay.tsx`
- [ ] `src/modules/Bacteria/presentations/components/ModulationDock.tsx`
- [ ] `src/modules/Bacteria/presentations/components/NodeGraphEditor.tsx`
- [ ] `src/modules/Bacteria/presentations/components/SpectralBinEditor.tsx`
- [ ] `src/modules/Bacteria/presentations/components/SpectrumAnalyzer.tsx`
- [ ] `src/modules/Bacteria/presentations/components/StepSequencerEditor.tsx`
- [ ] `src/modules/Bacteria/presentations/components/WaveshaperEditor.tsx`
- [ ] `src/modules/Bacteria/presentations/components/XYMorphPad.tsx`
- [ ] `src/modules/Collaboration/presentations/components/CollaborationBlock.tsx`
- [ ] `src/modules/Collaboration/presentations/components/CollaborationStatusRow.tsx`
- [ ] `src/modules/Collaboration/presentations/components/InviteCodeRow.tsx`
- [ ] `src/modules/Collaboration/presentations/components/PeerPresenceRow.tsx`
- [ ] `src/modules/Collaboration/presentations/components/PresenceLabel.tsx`
- [ ] `src/modules/Collaboration/presentations/components/PresenceMarker.tsx`
- [ ] `src/modules/Crust/presentations/components/CrustControlZone.tsx`
- [ ] `src/modules/Crust/presentations/components/CrustGainStrip.tsx`
- [ ] `src/modules/Crust/presentations/components/CrustMeteringStrip.tsx`
- [ ] `src/modules/Crust/presentations/components/CrustSatCurve.tsx`
- [ ] `src/modules/Crust/presentations/components/CrustWaveformDisplay.tsx`
- [ ] `src/modules/Fermenter/presentations/components/AdditiveSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/EffectsSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/EnvelopeSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/FilterSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/FmSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/GranularSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/KarplusSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/LayerStack.tsx`
- [ ] `src/modules/Fermenter/presentations/components/LfoSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/MacroStrip.tsx`
- [ ] `src/modules/Fermenter/presentations/components/ModulationSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/OscillatorSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/Oscilloscope.tsx`
- [ ] `src/modules/Fermenter/presentations/components/OutputMeter.tsx`
- [ ] `src/modules/Fermenter/presentations/components/PresetBrowser.tsx`
- [ ] `src/modules/Fermenter/presentations/components/SamplerSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/SectionNav.tsx`
- [ ] `src/modules/Fermenter/presentations/components/SignalFlowView.tsx`
- [ ] `src/modules/Fermenter/presentations/components/SpectrumAnalyzer.tsx`
- [ ] `src/modules/Fermenter/presentations/components/UnisonSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/WarpSection.tsx`
- [ ] `src/modules/Fermenter/presentations/components/XYPad.tsx`
- [ ] `src/modules/Gluten/presentations/components/GlutenCurve.tsx`
- [ ] `src/modules/Gluten/presentations/components/GrHistory.tsx`
- [ ] `src/modules/Gluten/presentations/components/GrMeter.tsx`
- [ ] `src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx`
- [ ] `src/modules/GrandBoule/presentations/components/MorphPanel.tsx`
- [ ] `src/modules/GrandBoule/presentations/components/PerNoteEditor.tsx`
- [ ] `src/modules/GrandBoule/presentations/components/PianoKeyboard.tsx`
- [ ] `src/modules/GrandBoule/presentations/components/PianoModel3D.tsx`
- [ ] `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx`
- [ ] `src/modules/GrandBoule/presentations/components/StringVibrationView.tsx`
- [ ] `src/modules/Levain/presentations/components/ArticulationList.tsx`
- [ ] `src/modules/Levain/presentations/components/ExpressionPanel.tsx`
- [ ] `src/modules/Levain/presentations/components/HumanizePanel.tsx`
- [ ] `src/modules/Levain/presentations/components/LegatoTuning.tsx`
- [ ] `src/modules/Levain/presentations/components/LevainMacroStrip.tsx`
- [ ] `src/modules/Levain/presentations/components/MicBlendSlider.tsx`
- [ ] `src/modules/Proof/presentations/components/LoudnessHistory.tsx`
- [ ] `src/modules/Proof/presentations/components/ProofDynSection.tsx`
- [ ] `src/modules/Proof/presentations/components/ProofEqCurve.tsx`
- [ ] `src/modules/Proof/presentations/components/ProofEqSection.tsx`
- [ ] `src/modules/Proof/presentations/components/ProofExciterSection.tsx`
- [ ] `src/modules/Proof/presentations/components/ProofImagerSection.tsx`
- [ ] `src/modules/Proof/presentations/components/ProofLimiterSection.tsx`
- [ ] `src/modules/Proof/presentations/components/TonalBalance.tsx`
- [ ] `src/modules/ProofChamber/presentations/components/DecayEqOverlay.tsx`
- [ ] `src/modules/ProofChamber/presentations/components/IrBrowser.tsx`
- [ ] `src/modules/ProofChamber/presentations/components/SignalFlowDiagram.tsx`
- [ ] `src/modules/SampleLibrary/presentations/components/FolderTree.tsx`
- [ ] `src/modules/SampleLibrary/presentations/components/LibraryRootCard.tsx`
- [ ] `src/modules/SampleLibrary/presentations/components/SampleRow.tsx`
- [ ] `src/modules/Sampler/presentations/components/PadGrid.tsx`
- [ ] `src/modules/Sampler/presentations/components/SamplerControls.tsx`
- [ ] `src/modules/Sampler/presentations/components/SliceOverlay.tsx`
- [ ] `src/modules/Sampler/presentations/components/WaveformDisplay.tsx`
- [ ] `src/modules/Toaster/presentations/components/PadGrid.tsx`
- [ ] `src/modules/Toaster/presentations/components/PadMixer.tsx`
- [ ] `src/modules/Toaster/presentations/components/StepSequencer.tsx`
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
- [ ] `src/modules/Workspace/presentations/components/Sidebar/sidebarConstants.ts`
- [x] `src/modules/Workspace/presentations/components/SourdawLogo.tsx`
- [x] `src/modules/Workspace/presentations/components/SpatialPanner.tsx`
- [x] `src/modules/Workspace/presentations/components/Transport/TransportSegmentedReadout.tsx`
- [x] `src/modules/Workspace/presentations/components/Transport/TransportValuePill.tsx`
- [x] `src/modules/Workspace/presentations/components/Transport/VoiceButton.tsx`
- [x] `src/modules/Workspace/presentations/components/Wavetable3D.tsx`
- [ ] `src/modules/Yeast/presentations/components/KeyboardSplit.tsx`
- [ ] `src/modules/Yeast/presentations/components/ProcessorParams.tsx`
- [ ] `src/modules/Yeast/presentations/components/StepPatternEditor.tsx`
