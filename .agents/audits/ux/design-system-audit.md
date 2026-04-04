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
2. Remaining plugin rail and quick-read specialization
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
- Floating shells, section labels, separators, swatch rows, and base menu actions are now shared, but repo-wide menus still drift once inline editors or richer embedded controls appear.

Representative files:
- `src/modules/Workspace/presentations/views/ClipView/PianoRollContextMenu.tsx`
- `src/modules/Arrangement/presentations/views/TrackContextMenu.tsx`
- `src/modules/Arrangement/presentations/views/TimelineEmptyMenu.tsx`
- `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx`

Needed:
- finish the remaining menu/popup surfaces
- formalize patterns for menus that contain inline editors or utility states

### 3. Compact readout and meter clusters are still duplicated inline

Open issue:
- Shared metric clusters now cover the status bar baseline, but mixer and analysis surfaces still compose too many small readout/meter clusters by hand.

Representative files:
- `src/modules/Workspace/presentations/views/StatusBar.tsx`
- `src/modules/Workspace/presentations/views/Mixer/ExpandedChannelStrip.tsx`
- `src/modules/AiRuntime/presentations/components/mixAnalysis/MixAnalysisSections.tsx`

Needed:
- tighter neutral metric-cluster composition
- less local assembly of labels, bars, and mono values outside the status bar

### 4. Inspector card/well structure is still too local

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

### 5. Mixer internals still repeat a distinct sub-language

Open issue:
- Mixer-local section shells, inset buttons, and strip-value text are now shared, but the remaining strip-side readout and popup language still drifts in the denser channel views.

Representative files:
- `src/modules/Workspace/presentations/views/Mixer/ExpandedChannelStrip.tsx`
- `src/modules/Workspace/presentations/views/Mixer/DeviceChainSection.tsx`
- `src/modules/Workspace/presentations/views/Mixer/SendsSection.tsx`
- `src/modules/Workspace/presentations/views/Mixer/IOSection.tsx`

Needed:
- finish the last channel-strip readout and popup variants without promoting mixer-only patterns globally

### 6. Several module-local helpers are still proto-primitives

Open issue:
- Some helpers are still only local even though the pattern may be broader than one module.

Representative files:
- inspector-local helpers under `src/modules/Workspace/presentations/components/Inspector`
- sidebar-local helpers
- plugin-local helper islands that still repeat beyond one module

Needed:
- continued evaluation of which helpers should stay local and which should be promoted intentionally
