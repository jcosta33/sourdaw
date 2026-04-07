# UX Design System Audit

## Scope

This file tracks the previously unresolved presentation-layer drift called out during the design-system cleanup pass.

The work in this branch stays aligned with `.agents/specs/look-and-feel.md`:

- understated DAW shell
- tactile, premium, vector-first surfaces
- calm hierarchy
- stronger plugin flair where appropriate

## Current Status

No unresolved issues remain in this audit's tracked scope.

## Resolution Summary

1. **DAW header and shell stragglers** — timeline chrome now flows through `src/modules/Arrangement/presentations/views/TimelineChromeSurface.tsx`; automation left-rail shells through `src/modules/Workspace/presentations/views/AutomationView/AutomationSidebarCell.tsx`; and the remaining Arrange/Clip-specific shells were intentionally kept local via `src/modules/Workspace/presentations/views/ArrangeEmptyStateShell.tsx` and `src/modules/Workspace/presentations/views/ClipEditorTray.tsx`.
2. **Floating menus and context surfaces** — richer timeline and editor menus now share `src/components/daw/DawContextMenuSurface.tsx`, `src/components/daw/DawMenuInlineEditor.tsx`, the expanded `DawMenuButton`, and mixer-local popup wrappers in `src/modules/Workspace/presentations/views/Mixer/MixerPopupMenu.tsx`.
3. **Compact readout and meter clusters** — repeated label/value/meter compositions now route through `src/components/daw/DawUtilityMetric.tsx`, while denser mixer fader clusters use `src/modules/Workspace/presentations/views/Mixer/MixerLevelReadout.tsx`.
4. **Inspector card/well structure** — inspector detail headers are now formalized with `src/modules/Workspace/presentations/components/Inspector/InspectorDetailHeader.tsx`, inset well variants are expressed through `InsetPanel`, and parameter cards consistently use inspector-local `SurfaceCard`.
5. **Mixer-local sub-language** — the denser channel-strip popups and readouts now use explicit mixer-local helpers instead of ad-hoc inline menu/readout assembly.
6. **Proto-primitives** — the remaining local helpers were reviewed and either promoted intentionally (`DawUtilityMetric`, menu primitives) or kept local where the pattern is still editor-, mixer-, or inspector-specific.
