# TimelineEditor module — Agent Guidelines

Owns user interface presentations, canvas/DOM interaction renderers, piano roll editing, automation lane views, tempo editor, and inspector property panels for the arrangement timeline; does not own arrangement data models (Arrangement), MIDI note storage (MIDI), or automation breakpoint storage (Automation).

## Public Contract Surface

- `presentations/views/`: `ArrangeView`, `AutomationBottomPanel`, `AutomationView`, `ClipView`, `InspectorPanel`, `TempoEditor`.
- `stores/`, `useCases/`, `events/`: No public domain stores, use cases, or events exported (pure presentation module).
- Handlers: None (dispatches actions via Command bus).

## Key Subsystems

- **Arrange View Timeline:** `ArrangeView` renders multi-track lanes, clip placements, marker bars, and ruler navigation.
- **Piano Roll & Clip Editor:** `ClipView` renders note canvases, velocity/pitch-bend/MPE lanes, and manages note interaction gestures (`usePianoRollInteractions`, `usePianoRollRenderer`).
- **Automation Surfaces:** `AutomationView` and `AutomationBottomPanel` provide lane drawing, node editing, and curve interpolation rendering.
- **Contextual Inspector:** `InspectorPanel` hosts modular property panels (`ChoiceCard`, `ControlHeader`, `InsetPanel`, `SurfaceCard`) for selected tracks, clips, and devices.
- **Tempo Editor:** `TempoEditor` provides timeline tempo mapping and time-signature curve manipulation.

## Invariants & Traps

- **Strict Presentation Isolation:** Must not store canonical timeline or MIDI state locally; all user interactions must dispatch actions via Command bus.
- **Viewport Math Consistency:** Canvas coordinate transforms between musical time/pitch and screen pixels must strictly follow `pianoRollConstants` and timeline view models to prevent layout drift.
- **Pointer Gesture Cleanup:** Mouse drag and pointer capture sessions must release listeners cleanly on blur, window unmount, or mouseup.

## Verification

```bash
pnpm vitest run src/modules/TimelineEditor
pnpm deps:validate
```
