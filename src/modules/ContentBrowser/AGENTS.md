# ContentBrowser module — Agent Guidelines

Workspace sidebar presentation container and navigation tabs (Project, Instruments, Effects, Samples, Online Samples, Macros), sidebar favorites persistence, and content auditioning (sample database indexing belongs to SampleLibrary; audio synthesis and hosting belong to PluginHost / AudioEngine).

## Public Contract Surface

- `presentations/views`: `Sidebar`, `SidebarPanelActions`.

## Key Subsystems

- **Sidebar Shell**: Multi-tab rail navigation container (`presentations/views/Sidebar.tsx`, `RailTabBar`, `RailBackBar`).
- **Browser Tabs**: Specialized tab views in `presentations/views/Sidebar/` (`ProjectTab`, `InstrumentsTab`, `EffectsTab`, `SamplesTab`, `OnlineSampleBrowser`, `MacrosPanel`).
- **Sidebar Components**: `presentations/components/Sidebar/` (`ChoiceCard`, `PresetItem`, `InstrumentCard`, `PreviewButton`, `SearchSummary`, `SectionHeader`, `EmptyState`).
- **Favorites Persistence**: Local storage persistence for favorited instruments, effects, and samples (`useCases/sidebar-favorites/`, `repositories/sidebar-favorites/`).
- **Audio Preview Hook**: `presentations/hooks/usePreviewAudio.ts` connects browser items to `AudioEngine` for sound auditioning prior to track insertion.

## Invariants & Traps

- **UI Presentation Boundary**: Purely presentational and transactional; never generates DSP audio or runs direct disk indexing.
- **Preset Loading Flow**: Loading presets routes through `executePresetLoad`, dispatching appropriate track creation and plugin state hydration actions.
- **Safe Preview Teardown**: Audio previews triggered via `usePreviewAudio` must cleanly release audio buffer resources on tab switches or component unmount.

## Verification

```bash
pnpm vitest run src/modules/ContentBrowser
```
