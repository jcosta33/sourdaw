# Workspace module audit

## Scope

This audit covers `src/modules/Workspace/` in full — stores, models,
useCases, handlers, repositories, events, and (most heavily) the
`presentations/` tree (views, components, hooks, helpers, renderers).
Workspace is the host module that wires together every other module's
panels, dialogs, side rails, mixer/clip/session/automation tabs,
status bar, transport bar, onboarding flow, and keyboard shortcuts.

It is an adversarial review: panel/layout invariants, header height
calculations, DnD between panels, keyboard shortcut conflicts, ResizeObserver
leaks, z-index stacking, empty-state correctness, type soundness,
React anti-patterns, and AGENTS.md compliance.

Related spec: none on disk.

---

## Goal

A coherent shell that:

- Exposes a single root `index.ts` cross-module surface, with all
  internals private (handlers/, models/, repositories/, services/,
  presentations/components/, presentations/hooks/), and where files
  inside `Workspace/` import other Workspace files relatively.
- Holds workspace-shape state (modes, selection, panel open/closed
  flags, sizes) in **one** place — no parallel `defaultWorkspaceState` or
  `defaultPreferences` declarations across the module.
- Decouples per-plugin panel sizing from the core `WorkspaceState`
  type — adding a new device panel is one line in a registry, not one
  field in `WorkspaceState`, one field in `defaultWorkspaceState`, one
  branch in `useActiveDevicePanel`, and a 16-line render block in
  `AppShell`.
- Renders only valid JSX (no boolean leakage from `&&`), avoids
  `useMemo`/`useCallback`/`React.memo` (React Compiler), uses ternaries
  / early returns for conditional UI, and never escapes types via
  `as any` / `as unknown as …`.
- Uses a single z-index scale documented in one place; keyboard
  shortcuts have a single `useGlobalKeyboardShortcuts` registry with
  no duplicate `window.addEventListener('keydown', …)` paths in
  presentation files.
- Cleans up every `ResizeObserver`, `addEventListener`, and global
  side-effect on unmount.
- Has empty-state UIs that are stable under HMR and that don't dispatch
  state updates from render.

---

## Relevant code paths

- `src/modules/Workspace/` — **no root `index.ts`** (see issue #1).
- `src/modules/Workspace/models/WorkspaceState.ts`
- `src/modules/Workspace/models/Preferences.ts`
- `src/modules/Workspace/models/EditingTool.ts`
- `src/modules/Workspace/stores/workspaceStore.ts`
- `src/modules/Workspace/stores/preferencesStore.ts`
- `src/modules/Workspace/stores/index.ts`
- `src/modules/Workspace/useCases/index.ts`
- `src/modules/Workspace/useCases/workspaceQueries/helpers.ts`
- `src/modules/Workspace/presentations/views/AppShell.tsx` (817 lines)
- `src/modules/Workspace/presentations/views/ArrangeView.tsx` (392 lines)
- `src/modules/Workspace/presentations/views/ClipView.tsx`
- `src/modules/Workspace/presentations/views/MixerPanel.tsx`
- `src/modules/Workspace/presentations/views/Sidebar.tsx`
- `src/modules/Workspace/presentations/views/StatusBar.tsx`
- `src/modules/Workspace/presentations/views/TransportBar.tsx`
- `src/modules/Workspace/presentations/views/OnboardingTour.tsx`
- `src/modules/Workspace/presentations/views/AudioResumeOverlay.tsx`
- `src/modules/Workspace/presentations/views/AnalysisPanel.tsx`
- `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts` (1466 lines)
- `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts-FIX-BRANCH` (orphan!)
- `src/modules/Workspace/presentations/hooks/useActiveDevicePanel.ts`
- `src/modules/Workspace/presentations/hooks/useAppInitialization.ts`
- `src/modules/Workspace/presentations/components/InstrumentBottomPanel.tsx`
- `src/modules/Workspace/presentations/components/ShortcutCheatSheet.tsx`

---

## Current behavior

**Module surface.** `Workspace/` has **no root `index.ts`**. Cross-module
consumers reach into `useCases/`, `stores/`, `events/`, and
`presentations/views/` directly via per-folder barrels. This breaks
AGENTS.md "Frontend DDD" — the root `index.ts` is meant to be the sole
public surface.

**Duplicate state defaults.** `defaultWorkspaceState` exists twice with
identical content: `models/WorkspaceState.ts:74` and
`stores/workspaceStore.ts:5`. `defaultPreferences` likewise exists in
`models/Preferences.ts:79` and `useCases/workspaceQueries/helpers.ts:34`.
Consumers of one will silently drift from the other.

**Panel layout.** `AppShell.tsx` is a single 817-line component that
hosts the entire shell: TransportBar → main horizontal flex (left
panels / center column / right panels) → StatusBar, plus 14 device
panels stacked at the bottom of the center column, plus a "bottom dock"
with 10 tab choices, plus the virtual keyboard panel, plus a mountain
of dialogs/overlays. Each device panel adds three things:
1. A field in `WorkspaceState` (`fermenterHeight`, `toasterHeight`, …)
2. A "open device" branch in `useActiveDevicePanel` (discriminated union)
3. A 16-line conditional render block in `AppShell`

**Header / chrome alignment with timeline lanes.** `ArrangeView.tsx:168`
computes the track-list `extraHeaderHeight` by summing six chrome
heights (`ARRANGEMENT_BAR_HEIGHT`, `getAdjustmentLayerStripHeight(...)`,
`MARKER_LANE_HEIGHT`, `MINIMAP_HEIGHT`, `BEAT_RULER_HEIGHT`,
`CHORD_TRACK_LANE_HEIGHT`) and conditionally includes marker / chord
lanes based on store state. Track-list and timeline are separately laid
out — when this sum drifts (e.g. someone adds a new lane), the track
rows visually disconnect from the timeline lanes.

**Keyboard shortcuts.** AppShell calls `useGlobalKeyboardShortcuts`
from `Command/presentations/views`. But seven other presentation files
also attach raw `window.addEventListener('keydown', …)`:
`OnboardingTour.tsx:195`, `ShortcutCheatSheet.tsx:133`,
`preferencesShared.tsx:81`, `AudioResumeOverlay.tsx:68`,
`useAppInitialization.ts:75`, `ShortcutsSection.tsx:144`,
`WaveformEditor.tsx:309`. None coordinate with the Command shortcut
registry — Escape, arrow keys, and other shortcuts can fire in
multiple places at once.

**ResizeObservers.** Eight separate `new ResizeObserver(...)` sites
across `presentations/` (`ArrangeView`, `AnalysisPanel`,
`AutomationBottomPanel`, `PianoRoll`, `PitchEditor`, `WaveformEditor`,
`LevelMeter`, `RailTabBar`). Some pass arrays where they should pass
single elements; some have stale-closure issues; cleanup pattern is
inconsistent.

**Type assertion escapes.** Multiple `as any` / `as unknown as` in test
files (Sidebar/InstrumentsTab, SamplesTab, DeviceInspector, AutomationView,
scratchPadHandlers, dualView, toggleSidebar, setTrackHeight, setWorkspaceMode,
workspaceMiscHandlers).

**Render-time `setState`.** `AppShell.tsx:361-363` calls `setShowLaunch(true)`
**directly during render** when an external condition flips. This is
the React anti-pattern that produces "Cannot update a component while
rendering a different component" warnings under StrictMode.

---

## Findings

1. **The module has no root `index.ts`.** Every other module in `src/modules/`
   has one (AiGeneration, AiRuntime, Arrangement, AudioAnalysis, AudioEngine,
   etc.). Workspace doesn't. Consumers either import deep paths
   (`#/modules/Workspace/stores`, `#/modules/Workspace/useCases`) — which
   is what the per-folder barrels are designed for — or they reach into
   private internals. AGENTS.md "Frontend DDD" says the root `index.ts`
   is the sole cross-module public surface; this module bypasses it.
   Cross-module callers can now import literally any per-folder barrel
   without a single chokepoint to police what's exposed.

2. **`defaultWorkspaceState` is duplicated.** Two ~50-line copies, one
   in `models/WorkspaceState.ts:74-125` and one in `stores/workspaceStore.ts:5-56`.
   They are byte-identical today but nothing prevents them from drifting.
   The store's copy shadows the model's; consumers of the model get one
   default and consumers of the store get the other.

3. **`defaultPreferences` is duplicated.** Same story:
   `models/Preferences.ts:79-107` vs.
   `useCases/workspaceQueries/helpers.ts:34-61`. Both are 27-line objects.
   `preferencesStore.ts:4` imports from the helpers (use cases) variant —
   a use-case file owning the canonical defaults inverts the dependency
   direction (stores should not depend on use cases).

4. **`WorkspaceState` carries 14 device-panel-height fields.** The
   `WorkspaceState` type fans out a height field per device:
   `fermenterHeight`, `toasterHeight`, `levainHeight`, `glutenHeight`,
   `bacteriaHeight`, `grinderHeight`, `proofChamberHeight`, `proofHeight`,
   `scoringHeight`, `yeastHeight`, `crustHeight`, `samplerHeight`,
   `grandBouleHeight`, `virtualKeyboardHeight`. Each is then duplicated
   in `defaultWorkspaceState` (twice, see #2). Each requires a render
   block in `AppShell.tsx:408-575` (170 lines of nearly-identical JSX —
   `InstrumentBottomPanel` with different label/color/height). Adding
   a 15th plugin panel touches 5 places.

   Should be: a `Record<DeviceKind, number>` registry plus a single
   `<DevicePanelDock activePanel={...} />` block.

5. **Orphan/scratch file: `usePianoRollInteractions.ts-FIX-BRANCH`.** A
   12-line file at `presentations/hooks/usePianoRollInteractions.ts-FIX-BRANCH`.
   It contains an isolated `if/else` block referencing
   `stepRecordStore.value`, `stepRecordNoteOn`, etc. Not a valid TS
   module, has no extension TypeScript will compile, but it's checked
   in. Per AGENTS.md (and user memory `feedback_no_root_auxiliary_files`),
   this is a forbidden auxiliary file. Looks like a leftover from a
   refactor branch that needs deletion.

6. **`AppShell.tsx` is a 817-line god-component with render-time setState.**
   `AppShell.tsx:361-363`:
   ```
   if (!project.initialized && !project.loading && !showLaunch && !launchExiting) {
       setShowLaunch(true);
   }
   ```
   This is `setState` during render — React's official anti-pattern.
   StrictMode will throw "Cannot update a component while rendering"
   if any sibling consumes `showLaunch`. Even though React 19 sometimes
   tolerates same-component updates during render, this should be a
   `useEffect` or, better, derived from `project` state without a
   separate `showLaunch` boolean.

7. **AppShell side effects mutate other panels' open state from a
   `useEffect`.** `AppShell.tsx:240-245`:
   ```
   useEffect(() => {
       if (selectedClipId) {
           setBottomTab('editor');
           openMixer();
       }
   }, [selectedClipId]);
   ```
   Selecting a clip silently force-opens the mixer dock and force-switches
   the bottom tab to "editor" — even if the user just closed the dock.
   This fights the user. Also: `AppShell.tsx:248-255` listens for an
   `onPanelShowAutomation` event and opens the mixer there too. Plus
   `AppShell.tsx:258-262` falls back to "editor" tab when the elastic
   precondition disappears. Three separate "auto-switch tab" effects
   layered on top of each other; each can race the others.

8. **Render-during-mount empty-state branching can swallow drag-and-drop.**
   `ArrangeView.tsx:139-145`: when `hasUserTracks === false`, the entire
   timeline column is replaced with `<EmptyArrangeOverlay />`, which
   itself handles drop. But `AppShell.tsx:404` wraps `<main>` with
   `contain-strict` — which combined with the `flex-1` column means the
   timeline ResizeObserver re-attaches every time `hasUserTracks` flips
   (`ArrangeView.tsx:117` lists `hasUserTracks` as a dependency). On
   first track add, the observer detaches and re-attaches once before
   reporting a real width. `viewportWidth` is initialized to
   `window.innerWidth` (`:78`) — i.e. the entire window, not the
   panel — so until the observer fires, the H-scrollbar math
   (`maxScrollX = totalContentWidth - viewportWidth`) is computed
   against the full window width and the scrollbar is hidden when the
   timeline is actually narrower than the window.

9. **`useGlobalKeyboardShortcuts` competes with seven raw `keydown`
   listeners.**
   - `OnboardingTour.tsx:195` — Escape, arrow keys to advance tour.
   - `ShortcutCheatSheet.tsx:133` — `?` to open, Escape to close.
   - `preferencesShared.tsx:81` — capture-phase capture for "press a key"
     UI in PreferencesDialog (uses `addEventListener('keydown', handler, true)`).
   - `ShortcutsSection.tsx:144` — same as above (capture-phase).
   - `AudioResumeOverlay.tsx:68` — any key resumes audio (`onceifferentiated`).
   - `useAppInitialization.ts:75` — first key-down to unlock audio.
   - `WaveformEditor.tsx:309` — Escape only.

   These are not registered with `Command/stores/shortcutStore`. When
   PreferencesDialog is open and the user presses `?` to invoke
   ShortcutCheatSheet, both fire. When OnboardingTour is open over
   AppShell, Escape advances the tour AND closes any open menu in
   parallel. There is no explicit ordering or capture/bubble
   coordination; capture-phase listeners (lines marked `, true)`) run
   before all the bubble-phase ones.

10. **ResizeObserver `disconnect` is sometimes correct but observe()
    targets vary.** `ArrangeView.tsx:109` creates a new observer in a
    `useLayoutEffect` that re-runs on `hasUserTracks` flips —
    correct cleanup with `observer.disconnect()` in the return. BUT
    `viewportWidth` is also stored as `useState(window.innerWidth)` —
    if the window resizes, the observer never fires (it only watches
    `el`, not `window`), so `viewportWidth` is stale until something
    else re-mounts the timeline.

    `LevelMeter.tsx:77` creates `new ResizeObserver((entries) => …)` with
    `entries` array; `AnalysisPanel.tsx:34` and
    `AutomationBottomPanel.tsx:62` and others use `([entry]) => …` —
    inconsistent destructuring; in cases where multiple targets are
    observed (rare here, but the pattern invites it) the destructure
    silently drops all but one.

11. **`AnalysisPanel.tsx:49`: `&&` rendering.** `{size.width > 0 &&
    size.height > 0 ? children(size) : null}` — uses ternary for the
    final fallback (good) but the **inner** condition `size.width > 0 &&
    size.height > 0` is a boolean truthy chain. AGENTS.md forbids `&&`
    in render. Also, the function shape here is `children: (size) =>
    ReactNode` — a render-prop. If `size.width === 0` (which it is on
    first render before the RO fires), `children` is never called —
    fine — but since `size` starts at `{ width: 0, height: 0 }`, every
    consumer re-renders once with `null`, then again on first RO
    callback. No memo on the consumer means double work.

12. **`&&` inside JSX rendering across multiple files.** AGENTS.md hard
    rule: "Never render with `&&` — use ternaries or early returns."
    Violations:
    - `EffectsTab.tsx:251,273,386,421` — `{filteredEffects.length > 0
      && (...)}` etc.
    - `MacrosPanel.tsx:119` — `{state.macros.length === 0 && !state.recording ? ... : ...}` (this one is a ternary, OK).
    - `Inspector/TrackMidiFxSection.tsx:97,126,150` — `{fx.type === 'arp'
      && (…)}` style.
    - `Inspector/TrackHeaderSection.tsx:95` — `{isStale && (…)}`.
    - `Inspector/HammondB3Layout.tsx:71` — `{otherParams.length > 0 && (…)}`.
    - `ClipView/PitchEditor.tsx:226,239,252` — `{!contour && !kneadState.isAnalyzing && (…)}` etc.
    - `Inspector/__tests__/ClipAudioAiSection.spec.tsx:107`,
      `ClipInspector.spec.tsx:127` — same in fixtures.

13. **Render-time `setState` repeats in `ArrangeView`.** `ArrangeView.tsx:64-67`:
    ```
    if (prevTrackListWidth.current !== trackListWidth) {
        prevTrackListWidth.current = trackListWidth;
        setLocalTrackListWidth(trackListWidth);
    }
    ```
    Same pattern at `:72-75`. While React 19 supports this "store
    derived state" pattern via `useState`'s setter-during-render, it's
    fragile and most teams use `useSyncExternalStore` or a derived value
    instead. The intent is "react to external prop changes by syncing
    local state" — that should be `useState(initial)` keyed on a stable
    id, or just use the external state directly.

14. **`useCases/index.ts` re-exports types — AGENTS.md violation.**
    `useCases/index.ts:55`:
    ```
    export type { Preferences, GridSnapOption, WorkspaceState, EditingTool } from './workspaceQueries/helpers';
    ```
    AGENTS.md "Use-case types stay private": "Do not `export type` from
    `useCases/` for other modules". Cross-module callers should not be
    importing `WorkspaceState` from Workspace's use-case surface.

15. **`useCases/workspaceQueries/helpers.ts` re-exports models.**
    Lines 1-32 import every model type and immediately re-export them.
    This file is meant to host helper functions; it has become a
    secondary type barrel. Combined with #14, `WorkspaceState` and
    `Preferences` are accessible to any cross-module caller through two
    separate paths. Compounded with the missing root `index.ts` (#1),
    every consumer has invented their own deep import path.

16. **Z-index ladder is uncoordinated.** Hard-coded values found:
    - `z-10` (track list seal, automation lane chrome, scratch pad sticky
      column header, RailTabBar fade gradients)
    - `z-30` (KneadEditor blocking overlay)
    - `z-40` (AutomationControls scrim)
    - `z-50` (popups, menus, ShortcutCheatSheet, TransportBar,
      AutomationView close button, NotificationToast,
      PromptBar dropdown, etc.)
    - `z-[200]` (`ConfirmDialog`)
    - `z-[9999]` (`LaunchScreen`, `MobileGate`, `ProjectLoadingOverlay`)
    - `z-[10000]` (`OnboardingTour`, `AudioResumeOverlay`)

    Two files use the same `z-[10000]` — `OnboardingTour` and
    `AudioResumeOverlay`. If both are visible at once (rare but
    possible: audio context suspended during onboarding tour), DOM
    order alone decides which paints on top; AppShell renders
    `AudioResumeOverlay` last (`AppShell.tsx:811`) before
    `OnboardingTour` (`:813`), so onboarding wins — but this is
    accidental, not enforced. There is no central z-index scale; new
    overlays will pick numbers by guesswork.

17. **`AppShell.tsx` `bottomTab` is a 10-way string union with no
    enum / `as const` constant.** Lines 150-161 declare an inline union:
    `'editor' | 'mixer' | 'session' | 'routing' | 'analysis' |
    'automation' | 'setlist' | 'loopStation' | 'modulation' | 'elastic'`.
    Each tab has its own button (lines 599-697), color class, and
    onclick. Adding a tab requires editing 4 places (union, button JSX,
    panel-content branch in the giant ternary at 712-732, color class).

18. **`AppShell.tsx` panel-content selector is a 10-way ternary chain.**
    Lines 712-732:
    ```
    {bottomTab === 'editor' ? <ClipView />
     : bottomTab === 'mixer' ? <MixerPanel … />
     : bottomTab === 'automation' ? <AutomationBottomPanel />
     : bottomTab === 'session' ? <SessionView />
     : bottomTab === 'analysis' ? <AnalysisPanel />
     : bottomTab === 'setlist' ? <SetlistPanel />
     : bottomTab === 'loopStation' ? <LoopStationPanel />
     : bottomTab === 'modulation' ? <ModulationMatrix />
     : bottomTab === 'elastic' ? <ElasticEditorPanel />
     : <RoutingMatrix />}
    ```
    The default fallback is `<RoutingMatrix />` — i.e. an unknown
    `bottomTab` value silently renders Routing. There is no exhaustive
    switch via `satisfies` to catch a missed tab. AGENTS.md
    `docs/07-conventions.md` discourages chained ternaries.

19. **`bottomTab` is local React state, not workspace state.** Tabs
    aren't persisted across reload — closing/reopening the app loses
    the tab. Inconsistent with other panel state (`mixerOpen`,
    `sidebarOpen`, etc.) which lives in `workspaceStore`. Three of the
    auto-switch effects (`selectedClipId`, `onPanelShowAutomation`,
    elastic-precondition) all push into local state that itself can
    only be set by user click.

20. **`InstrumentBottomPanel` is rendered 14 times with cosmetic
    differences.** `AppShell.tsx:408-575`. Each block is identical
    except for label string, label-color class, border-color class,
    height/setter pair, and the panel component itself. Plus
    `closeActivePanel` is the same across all 14. This is the textbook
    case for a small registry/data-driven render. The cost of adding a
    new instrument panel today is 5 places.

21. **`activePanel` discriminated union has 14 branches; `useActiveDevicePanel`
    is the choke point.** Each plugin contributes one `kind` literal.
    Adding a plugin means one line in the union and one line in the
    `which` extraction (`AppShell.tsx:166-179`):
    ```
    const fermenterDeviceId = activePanel?.kind === 'fermenter' ? activePanel.deviceId : null;
    ```
    14 of these in a row. A single `Record<DeviceKind, deviceId | null>`
    derived once would compress this to one line.

22. **`makeDimSetter` allocates a new closure per panel per render.**
    `AppShell.tsx:286-287`:
    ```
    const makeDimSetter = (key: DimKey, current: number) => (fn: (prev: number) => number) =>
        updateWorkspaceState({ [key]: fn(current) });
    ```
    Then 18 consecutive calls (`:289-306`). Each render creates 18
    closures. None are passed to memoised children, so this isn't a
    correctness bug, but it's a code-smell created by working around the
    14-panel sprawl.

23. **`renderSidePanel` returns a `<>...</>` fragment with a key-less
    `<DragResizeHandle>` and `panel`.** `AppShell.tsx:312-334`. When the
    parent (the outer flex) reconciles two side panels in a row, React
    can't distinguish them by index across renders if the fragment moves;
    the keyless fragment children inherit the order. Today there are
    eight calls to `renderSidePanel` — four left, four right (sidebar,
    inspector, chat, ai). When `panelPlacementSidebar` flips from
    `'left'` to `'right'`, the panel re-mounts (good) but the
    DragResizeHandle remounts on the opposite side, losing pointer
    capture if a drag was in flight.

24. **`AppShell.tsx` imports cross-module from 18+ modules in a single
    file.** Lines 8-30 + 60-65 + 72: AiGeneration, AudioEngine,
    AiRuntime, Automation, Bacteria, Command, Crumbs, Crust, Fermenter,
    Gluten, GrandBoule, Grinder, Levain, Plugin (ProofChamberPanel),
    Toaster, Transport, Proof, Scoring, Yeast, VirtualKeyboard,
    Project, Collaboration (lazy), CrdtDocument (lazy). This is the
    correct boundary (root-barrel cross-module imports per AGENTS.md),
    but the count is a smell — AppShell is the integration point for
    every plugin/panel in the app.

25. **`InstrumentBottomPanel.tsx` is a private internal that 14 panels
    depend on.** Adequate for now but: it lives in
    `presentations/components/`, which is module-private. Any other
    module wanting "show a resizable bottom dock for my plugin"
    re-implements this. If/when a new module owns its own bottom dock
    UI, this will likely get duplicated rather than shared.

26. **`useAppInitialization.ts:75` registers `keydown { once: true }`
    before unmount — but doesn't `removeEventListener`.** The `{ once:
    true }` option auto-detaches after one fire, so this is harmless
    when the user actually presses a key. But if the AppShell unmounts
    before the user gestures (e.g. HMR), the listener leaks until the
    user later presses a key on the (now stale) listener. Pattern is
    fragile.

27. **`AudioResumeOverlay.tsx:68` adds a `keydown` listener.** Combined
    with `useAppInitialization` (also keydown) and the seven other
    listeners, audio resume gestures may fire twice (once for the
    overlay's own click handler, once for the global listener). Browser
    user-activation rules require a real gesture — duplicate listeners
    don't break it, but they do double-fire any side effect attached.

28. **`OnboardingTour.tsx` listens for keydown but doesn't use the
    Command shortcut store.** Onboarding navigation (next/prev/skip) is
    not registered with `useGlobalKeyboardShortcuts`. If a user has
    rebound `ArrowRight`/`ArrowLeft` (hypothetical: scrubbing playhead),
    the onboarding tour silently steals those keys for the duration
    of the tour.

29. **`MobileGate.tsx` is a hard-coded breakpoint with `z-[9999]`.**
    Wrapping all of AppShell. If a desktop user resizes their browser
    narrow, the gate snaps in and unmounts the entire app tree — losing
    all transient state (selection, undo stack reachability, panel
    drag state). No "I know I'm on a narrow window, hide this gate"
    escape.

30. **No `<ErrorBoundary>` around `AppShell`'s children.** AppShell
    imports `ErrorBoundary.tsx` exists in `components/` but is not used
    inside AppShell at all. Every plugin panel (Fermenter, Toaster,
    Levain, …) renders bare. A plugin panel throwing during render
    crashes the whole app instead of just the panel.

31. **Test files use `as any` and `as unknown as` extensively.** AGENTS.md
    "TypeScript — soundness" forbids these escapes.
    - `Sidebar/__tests__/InstrumentsTab.spec.tsx:33,34,49,50,65,66`
      (six `as any`).
    - `Sidebar/__tests__/SamplesTab.spec.tsx:35,48,61` (three
      `as unknown as`).
    - `Sidebar/__tests__/effectsTabHelpers.spec.tsx:33`.
    - `Inspector/__tests__/DeviceInspector.spec.tsx:68,73,78,85`
      (four `as any`).
    - `views/__tests__/AutomationView.spec.tsx:46,65`.
    - `handlers/workspace/__tests__/handleSetWorkspaceMode.spec.ts:52`
      (`@ts-expect-error` with no removal-path comment).
    - `handlers/workspace/__tests__/workspaceMiscHandlers.spec.ts:61,73`.
    - `handlers/scratchPad/__tests__/scratchPadHandlers.spec.ts:30,35,43,55,61`
      (five — these `set({ scratchPadOpen: ... } as any)` casts
      indicate the store's `set` signature accepts only full-state, not
      partials, but the test wants partials).
    - `useCases/togglePanel/panelToggles/__tests__/dualView.spec.ts:22`.
    - `useCases/togglePanel/panelToggles/__tests__/toggleSidebar.spec.ts:39`.
    - `useCases/__tests__/setTrackHeight.spec.ts:24`.
    - `useCases/__tests__/setWorkspaceMode.spec.ts:14`.

32. **`scratchPadHandlers.spec.ts` casts partial state to `any` because
    `workspaceStore.set` expects full state.** Five `as any` casts.
    The real fix is either a `partialUpdate` API on the store or test
    fixtures that provide the full `WorkspaceState`. The cast hides a
    contract problem.

33. **`ArrangeView.tsx:217` reduce uses `message`/`context` for
    accumulator/value names.** `tracks.reduce((max, time) => { const
    trackMax = time.clips.reduce((message, context) => (context.endBeat
    > message ? context.endBeat : message), max); return trackMax; },
    256)`. Variable names `time` (track), `message` (accumulator),
    `context` (clip) are nonsensical — looks like an automated
    code-rename gone wrong (consistent across the file: `useTracks`
    .filter uses `time` for track too on `:59`, `EmptyArrangeOverlay`
    likewise). Hurts readability and indicates someone ran a
    bulk-rename in a way the user explicitly forbade
    (`feedback_no_automated_bulk_edits`).

34. **`ArrangeView.tsx:223` `trackMax` is computed but the outer
    `.reduce` returns `trackMax` instead of `Math.max(max, trackMax)`.**
    Each track replaces the previous max instead of being max'd against
    it. Effect: the final result is the **last track's** max endBeat,
    not the max across all tracks. If the last track is empty,
    `totalContentWidth` is just `256 * pixelsPerBeat`, no matter how
    long any earlier track is.

    Repro: 3 tracks. Track 1 has clip at endBeat 100. Track 2 has clip
    at endBeat 200. Track 3 is empty. The reducer accumulates
    `max=256`, then `time=track1`: `trackMax = max(256, 100) = 256`,
    return 256. `time=track2`: `trackMax = max(256, 200) = 256`,
    return 256. `time=track3`: returns 256. So the answer is right for
    this case, but only because `max` is seeded with 256. Try Track 2
    endBeat 500: `time=track2`: inner reduce returns 500 (since 500
    > 256). `time=track3` (empty): `trackMax = …reduce(..., 500) =
    500` (no clips), returns 500. **Final answer 500 — but only because
    the inner accumulator starts at the outer `max`.** Subtle, working
    by coincidence. Comment explains nothing; renaming `max` to
    `currentMax` and returning `Math.max(currentMax, trackMax)` would
    be honest.

35. **`ArrangeView.tsx:206-271` `TimelineHScrollbar` adds
    window-scoped mouse listeners but never debounces / throttles
    `setScrollX` calls.** `setScrollX` runs on every `mousemove` —
    `setScrollX` writes to `timelineViewStore`, which triggers all
    subscribers (every track row, the BeatRulerBar, ArrangementBar,
    MarkerLane, AdjustmentLayerStrip). At 60 Hz mouse, that's 60
    `setScrollX` per second pushing through a store that drives a
    complex render tree. No `requestAnimationFrame` throttle.

36. **`EmptyArrangeOverlay.handleDrop` swallows decode errors but
    silently leaves orphan tracks.** `ArrangeView.tsx:298-318`: an
    `addTrack` is dispatched first, then `decodeAudioFile(file)` is
    awaited, then `addClip` is dispatched. If decode throws, the
    `try/catch` notifies the user but the empty track stays — the user
    sees a track with no clip and no error context on the track
    itself. Reverse the order or `removeTrack` on failure.

37. **`EmptyArrangeOverlay.handleDrop` does sequential awaits in a for
    loop.** `ArrangeView.tsx:284-319`: each file's MIDI import / audio
    decode awaits the previous. Drag-dropping 10 audio files imports
    them serially; user waits 10× decode time. Use
    `Promise.all(files.map(decode))` and dispatch additions in order.

38. **`EmptyArrangeOverlay.handleDrop` uses string-based extension
    detection that misses uppercase + edge cases.** `:285-286`:
    `file.name.toLowerCase().split('.').pop() ?? ''` — files like
    `kick.WAV` → ok (toLowerCase). `kick.tar.gz.wav` → ok (last segment).
    But `myfile` (no extension) → `''` and falls through; mime check is
    fallback. OK in practice, but the `audio/midi` mime check at `:286`
    on the same line uses `file.type` directly (no fallback to
    extension when MIME is missing — common on Windows) — so a
    `.mid` with `application/octet-stream` is detected purely by the
    extension branch.

39. **`AppShell` keyboard skip-link at line 379-384 has no shadow
    `<main>` target outside the shell wrapper.** Skip-link points to
    `#main-content`, which is the `<main id="main-content">` at line
    404 — works in normal flow. But when a modal dialog is open
    (`PreferencesDialog`, `ExportDialog`, `ConfirmDialog`,
    `AlphaNoticeDialog`), the skip-link still scrolls focus to
    `#main-content` underneath the modal — i.e. focus jumps **behind**
    the dialog. Skip-link should be hidden when a modal is open.

40. **`AppShell.tsx` chord/marker/scratch lane heights are imported
    raw from `Arrangement/presentations/views`.** Lines 22-26:
    `ARRANGEMENT_BAR_HEIGHT`, `BEAT_RULER_HEIGHT`, `MARKER_LANE_HEIGHT`,
    `MINIMAP_HEIGHT`, `getAdjustmentLayerStripHeight` — five constants
    crossing the module boundary and used to compute the track-list
    `extraHeaderHeight` in `ArrangeView.tsx:168-176`. The math is:
    ```
    ARRANGEMENT_BAR_HEIGHT
    + getAdjustmentLayerStripHeight(adjustmentLayerCount)
    + (hasMarkers ? MARKER_LANE_HEIGHT : 0)
    + MINIMAP_HEIGHT
    + BEAT_RULER_HEIGHT
    + (hasChords ? CHORD_TRACK_LANE_HEIGHT : 0)
    ```
    The track-list `<TrackListView style={{ width }} extraHeaderHeight={...} />`
    receives the sum and pads its top by exactly that. If `Arrangement`
    adds a new chrome lane (e.g. tempo curve), this sum drifts and
    track rows misalign with timeline lanes by exactly the omitted
    height. There is no test asserting alignment.

41. **`getAdjustmentLayerStripHeight(adjustmentLayerCount)` dispatches
    on a count, not on a list.** Reading `ArrangeView.tsx:170`:
    `getAdjustmentLayerStripHeight(adjustmentLayerCount)`. The function
    name implies "compute height from count" — but layers can have
    different heights (e.g. a tempo layer vs. a key layer). If
    Arrangement ever adds variable-height layers, this contract breaks
    silently.

42. **`ArrangeView.tsx:78` uses `window.innerWidth` for initial
    `viewportWidth`.** The actual viewport width is the timeline
    container's width, not the window's. On first paint (before the
    `useLayoutEffect` runs), `viewportWidth = window.innerWidth` —
    typically much wider than the timeline column once the trackList
    and side panels are accounted for. The H-scrollbar's "is content
    overflowing" check (`totalContentWidth <= viewportWidth`) is wrong
    on first frame; the scrollbar appears/disappears once on mount.

43. **Drag-and-drop between panels: no central DnD coordinator.**
    Drop handlers are scattered:
    - `ArrangeView.tsx:276` `EmptyArrangeOverlay.handleDrop` (audio/midi
      files into empty timeline)
    - Plus dozens of `onDragStart`/`onDragOver`/`onDrop` across
      `presentations/views/Sidebar/`, `Inspector/TrackDevicesSection.tsx`,
      etc. (cross-references via grep would expand this).

    No shared "drag type" registry or coordinator — each drop handler
    re-implements MIME / file-type detection. A sample dragged from
    Sidebar's Samples tab into the empty arrange overlay does not
    reuse the file-drop pipeline; it flows through a different code
    path inside `Arrangement`. Audit cross-reference: `Arrangement`
    audit should confirm.

44. **`useGlobalKeyboardShortcuts` is called from `AppShell` but every
    presentation file with its own `keydown` listener bypasses it.**
    See #9. Concretely:
    - User opens OnboardingTour. Pressing Escape advances the tour
      (`OnboardingTour.tsx`) AND closes the command palette
      (registered shortcut). Both fire because they're registered
      separately and OnboardingTour's listener doesn't `stopPropagation`.

45. **Storage-store boot order: `preferencesStore` blocks first
    paint.** `stores/preferencesStore.ts:16` calls `mergeWithDefaults()`
    synchronously on module load. The `createLocalStorage` is sync but
    `localStorage.getItem` is sync too. Side effect: reading
    localStorage on first render of any consumer (`AppShell.tsx:138`)
    is fine in practice but blocks parsing/JSON-parsing the entire
    preferences blob in the main thread before the component renders.
    For a 5-prop preferences object this is negligible, but the
    pattern suggests we do it at app boot rather than in a Suspense
    boundary.

46. **`preferencesStore`'s `mergeWithDefaults` does shallow merge of
    `Preferences`.** `stores/preferencesStore.ts:11`: `{...defaultPreferences,
    ...stored}`. If a stored preference is `null` (e.g. corrupted
    storage), it overrides the default with `null`. There's no
    runtime validation (Zod, etc.) of the stored shape. Any `Preferences`
    field that is structurally typed (e.g. `panelPlacementSidebar:
    'left' | 'right'`) accepts `'whatever'` from storage with no
    runtime check.

47. **`AppShell.tsx:139` reads from `trackStore` with a default of
    `{ tracks: [], selectedTrackId: null }`.** Cross-module store read.
    Used to compute `isAudioClipSelected`. Every track add / clip add /
    selection change re-renders AppShell. AppShell already has heavy
    side effects; this re-render cost is the cost of every `trackStore`
    update. Should be in a child component that itself subscribes.

48. **`AppShell.tsx:215` reads `trackStore.value?.tracks.length ?? 0`**
    inside an effect. Calling `trackStore.value` reads the current
    snapshot synchronously, but the effect dependency array is
    `[project.initialized, showAlphaNotice]` — so when tracks change
    after onboarding triggered, the effect doesn't re-evaluate. The
    `subscribe(...)` at `:225` covers this, but the dual read +
    subscribe pattern is fragile and the unsubscribe leak on missing
    return-path (`:228`) is partial: if `isOnboardingCompleted()` flips
    true before any track is added, the subscribe stays attached
    forever (the `unsubscribe()` call at `:227` is reached, but the
    early-return path at `:212-213` never unsubscribes — although
    that's outside this `useEffect`, so OK).

49. **`AppShell.tsx:204-237` onboarding effect leaks subscription when
    `showAlphaNotice` flips to true mid-flight.** Let `project.initialized
    = true`, `showAlphaNotice = false`, no tracks. Effect runs, attaches
    `trackStore.subscribe(...)`. User dismisses alpha notice before
    adding a track — `showAlphaNotice` never flips to true here (notice
    was already false), but if the component re-renders before the
    subscribe fires, the cleanup is `() => { unsubscribe(); }`.
    Actually, looking again: `:234-236` does `return () =>
    unsubscribe()`, which IS the cleanup. OK — false alarm. But the
    early returns at `:206-213` return `undefined`, not a cleanup, so
    when those branches fire and the effect re-runs from a dependency
    change, no cleanup runs. Fine for the early-return paths since
    they don't subscribe, but the asymmetry invites bugs on future
    edits.

50. **`AppShell.tsx` lazy panel imports are not Suspense-fallback-aware.**
    Lines 87-97: `CollaborationPanelLazy`, `BranchManagerDialogLazy`
    are `lazy()` imports. `<Suspense fallback={null}>` at `:774,779`
    renders nothing while loading — user clicks "Open collaboration
    panel" and sees nothing for 1+ seconds on slow networks. No
    spinner / "loading…" indicator.

51. **`AppShell.tsx:382` skip-link `focus:absolute focus:z-50` clashes
    with the bottom dock z-50 stack.** When focused, the skip-link
    renders `absolute z-50` over the transport bar (which is `z-50`)
    and… exactly the same z. DOM order decides; AppShell renders
    skip-link first so it's actually below TransportBar. Skip link
    visually disappears behind the transport bar. Should be `z-[9999]`
    or higher.

52. **`AppShell.tsx` does not mark the bottom dock with `role` or
    `aria-label`.** The mixer dock at lines 584-734 is a major
    landmark with 10 tabs but renders as a bare `<div>`. No `role="tablist"`
    on the tab bar; the tab buttons are `<Button>` components from
    `#/components/ui/button` with no `role="tab"` or
    `aria-selected={bottomTab === 'mixer'}`. AT users see 10 unrelated
    buttons.

53. **`AppShell.tsx:706` close button has `aria-label="Close bottom
    dock"` but no `role="region"` on the dock region.** The close
    button is the only labelled element. The 14 plugin panels likewise:
    `InstrumentBottomPanel` likely lacks region semantics (need to read
    its source — see issue 55). Each instance gets `label="Fermenter"`
    string but no `role="region" aria-label="Fermenter"`.

54. **`AppShell.tsx` keyboard shortcut docs vs implementation drift.**
    Comment at `:182-187` says shortcuts are "unified under
    `useGlobalKeyboardShortcuts` / `Command/stores/shortcutStore`" but
    AppShell still has render-time auto-switch logic on line 240-262
    that intercepts the user's tab choices (issue #7). Docs claim a
    single source of truth; reality has at least four (the registry,
    the three `useEffect` blocks, and the seven other `keydown`
    listeners).

55. **`InstrumentBottomPanel.tsx` is a 14-customer dependency** that
    needs review — labels are passed as plain strings (no i18n hook),
    colors as Tailwind class strings (so a typo in a passed
    `labelColor` silently degrades). API takes `height: number` and
    `onResize: (fn: (prev: number) => number) => void` — same shape as
    the AppShell setters. Each instance allocates its own resize
    handler (issue #22). Cross-reference: read this file in a follow-up
    pass.

56. **`StatusBar.tsx` (232 lines) and `TransportBar.tsx` (158 lines)
    not deeply audited yet.** Both are core chrome elements rendered
    by AppShell. Both must align with the timeline's chrome heights
    (`StatusBar` is below the panels, so it doesn't affect timeline
    alignment, but `TransportBar` is above `<main>`). Need a follow-up
    read to confirm `--spacing-transport-height` matches expectations
    and that none of the bar heights are duplicated.

57. **No central panel-layout invariant test.** Searched for
    `extraHeaderHeight` / `track-list alignment` / etc.: nothing
    asserts that the track-list header height equals the sum of all
    timeline chrome heights in the same DOM. A single visual
    regression of one or the other goes uncaught by tests.

58. **`AppShell.tsx` empty-state UI is `EmptyArrangeOverlay` (in
    `ArrangeView.tsx`) — but `MixerPanel` / `SessionView` / `ClipView` /
    `AnalysisPanel` empty states are scattered across each view file.**
    `ClipView.tsx:36-49` returns its own `<DawBlockedState>`. Each
    panel has bespoke empty UI; no shared "no project / no tracks /
    no selection" component family beyond `DawBlockedState` /
    `DawEmptyState` from `#/components/daw`. UX inconsistency.

59. **DnD: dragging a clip from PianoRoll to Arrangement is
    undocumented.** `usePianoRollInteractions.ts` (1466 lines) handles
    notes only. No clip-level drag from inside the piano roll out to
    Arrangement. If users expect "drag this clip to a new track" or
    "drag this clip to the sample browser to save as a preset", neither
    works.

60. **`useCases/togglePanel/panelToggles/` has 22 files, one per
    toggle.** "One function per file" is the AGENTS.md rule for
    `useCases/`. The directory is correctly structured. But many
    files are 5-10 lines each — they could be consolidated into a
    single `panelToggles.ts` exporting all 22 named functions while
    still satisfying the rule (since each is one function). The
    current structure inflates file count without clarity.

---

## Priorities

1. **SessionView's "Launch" button doesn't launch anything** (issues
   #47, #48). Theatrical UI — the comment in
   `sessionLaunchStore.ts:11` admits the audio-engine wiring is "follow-up".
   Users see Ableton-like Session grid, click Launch, nothing plays.
   Misleading-by-construction; users will report bugs against this
   non-feature.
2. **Codemod artifacts (`renderIife_N`) and bulk-rename damage
   (`(time)` for tracks)** (issues #41, #42). 8+ files have meaningless
   auto-generated function names; 30+ sites have lambdas where
   `(time)` is actually a track or tag. Direct violation of user
   memory `feedback_no_automated_bulk_edits`. These are reversible
   manually but the longer they stay the more tests/PRs reference
   them.
3. **Module surface broken — no root `index.ts`** (issue #1). Every
   cross-module consumer is importing through ad-hoc deep paths.
   Mechanical fix; unblocks AGENTS.md compliance for the rest.
4. **Render-time `setState` and side-effect cascade in AppShell**
   (issues #6, #7, #24, #54). Three "auto-switch tab" effects + render-time
   `setShowLaunch` create a state machine that fights the user.
   User-visible: opening the mixer opens the bottom dock you just
   closed, switches to "editor" tab without asking.
5. **`defaultWorkspaceState` × 2, `defaultPreferences` × 2**
   (issues #2, #3). Drift bombs — one will diverge during a refactor.
6. **`WorkspaceState` carries 14 device-panel heights** (issues #4,
   #20, #21). Every new plugin touches 5+ files. The single biggest
   ongoing maintenance tax in the module. Compounded by the
   "deprecated parallel API" half-migration (#43).
7. **Off-by-edge bug in `ArrangeView.TimelineHScrollbar`** (issue
   #17). The reducer works only because of a coincidental seed value;
   one careful refactor will silently break the scrollbar.
8. **Keyboard shortcut fragmentation** (issues #9, #28, #44). Seven
   raw `keydown` listeners outside the Command shortcut store.
9. **Orphan `usePianoRollInteractions.ts-FIX-BRANCH`** (issue #5).
   Delete it.
10. **Type-soundness escapes in tests + production** (issues #20, #28,
    #44, #48). Many `as any` / `as unknown as` casts hide real contract
    gaps. Two are in production: `useActiveDevicePanel.ts:66` and
    `SessionView.tsx:93`.

---

## Open issues

### 1. Workspace has no root `index.ts`

**Problem:** Every other module in `src/modules/` has a root
`index.ts` that is the sole cross-module public surface. Workspace
doesn't. Cross-module consumers (`#/modules/Workspace/stores`,
`#/modules/Workspace/useCases`, `#/modules/Workspace/events`,
`#/modules/Workspace/presentations/views`) import through per-folder
barrels with no central choke point. AGENTS.md "Frontend DDD" mandates
a root `index.ts`.

**Representative files:**

- `src/modules/Workspace/` (no `index.ts`)
- `src/modules/Workspace/useCases/index.ts:1-69`
- `src/modules/Workspace/stores/index.ts:1-10`
- `src/modules/Workspace/events/index.ts:1-15`
- `src/modules/Workspace/presentations/views/index.ts:1-3`

**Needed:** Create `src/modules/Workspace/index.ts` that re-exports
from `./useCases`, `./events`, `./stores`, `./presentations/views`.
Audit cross-module imports and replace deep paths
(`#/modules/Workspace/stores`, etc.) with `#/modules/Workspace`.
Strip the type re-exports from `useCases/index.ts` (issue #14) before
this lands.

---

### 2. `defaultWorkspaceState` is duplicated

**Problem:** Two byte-identical 50-line objects:
`models/WorkspaceState.ts:74-125` and `stores/workspaceStore.ts:5-56`.
They will diverge.

**Representative files:**

- `src/modules/Workspace/models/WorkspaceState.ts:74`
- `src/modules/Workspace/stores/workspaceStore.ts:5`

**Needed:** Delete the copy in `workspaceStore.ts`; import from
`../models/WorkspaceState`. Verify `WorkspaceState` is the canonical
type.

---

### 3. `defaultPreferences` is duplicated

**Problem:** Two copies:
- `models/Preferences.ts:79-107`
- `useCases/workspaceQueries/helpers.ts:34-61`

`preferencesStore.ts:4` imports the helpers (use cases) variant; this
inverts the dependency direction (stores depending on use cases). The
helpers file also re-exports model types as a secondary type barrel
(see issue #15).

**Representative files:**

- `src/modules/Workspace/models/Preferences.ts:79`
- `src/modules/Workspace/useCases/workspaceQueries/helpers.ts:34`
- `src/modules/Workspace/stores/preferencesStore.ts:4`

**Needed:** Keep `defaultPreferences` only in `models/Preferences.ts`.
`preferencesStore` imports from `../models/Preferences` directly. Drop
the type re-exports in `helpers.ts`. Drop `TRACK_HEIGHT_VALUES` and
`TOOL_SHORTCUTS` if they're not actually use-case logic (move to
`models/` or to a `services/` registry).

---

### 4. `WorkspaceState` carries 14 device-panel-height fields

**Problem:** `WorkspaceState` includes `fermenterHeight`, `toasterHeight`,
`levainHeight`, `glutenHeight`, `bacteriaHeight`, `grinderHeight`,
`proofChamberHeight`, `proofHeight`, `scoringHeight`, `yeastHeight`,
`crustHeight`, `samplerHeight`, `grandBouleHeight`, `virtualKeyboardHeight`.
Each requires:
- A field in `WorkspaceState` and `defaultWorkspaceState` (×2 — see #2)
- A branch in `useActiveDevicePanel` (discriminated union)
- A 16-line `<InstrumentBottomPanel>` block in `AppShell.tsx`
- A `makeDimSetter` call in `AppShell.tsx`

Adding the next plugin is 5 places.

**Representative files:**

- `src/modules/Workspace/models/WorkspaceState.ts:55-70`
- `src/modules/Workspace/stores/workspaceStore.ts:39-55`
- `src/modules/Workspace/presentations/hooks/useActiveDevicePanel.ts`
- `src/modules/Workspace/presentations/views/AppShell.tsx:120-179,289-306,408-575`

**Needed:** Replace 14 height fields with one `panelHeights:
Record<DevicePanelKind, number>` map. Replace 14 `<InstrumentBottomPanel>`
JSX blocks with one `<DevicePanelDock />` driven by a registry
(`DEVICE_PANEL_DESCRIPTORS: { kind, label, color, component }`).

---

### 5. Orphan scratch file `usePianoRollInteractions.ts-FIX-BRANCH`

**Problem:** A 12-line file with `if/else` keyboard handler code,
unbuildable, checked in. Not imported anywhere. Likely a leftover from
a refactor branch. Per user memory `feedback_no_root_auxiliary_files`,
auxiliary files belong under `.agents/tasks/`, never the source tree.

**Representative files:**

- `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts-FIX-BRANCH`

**Needed:** Delete the file (per user instruction — surface in audit
finding rather than deleting unilaterally).

---

### 6. AppShell calls `setState` during render

**Problem:** `AppShell.tsx:361-363`:
```
if (!project.initialized && !project.loading && !showLaunch && !launchExiting) {
    setShowLaunch(true);
}
```
`setShowLaunch` runs during render. React's docs explicitly classify
this pattern as "use only as a last resort" — and it's used here for
state that could be derived from `project` directly:
`showLaunch = !project.initialized && !project.loading` plus an
`exiting` derived from a state machine.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:358-374`

**Needed:** Replace with a derived `useState` machine reacting via
`useEffect` to `project.initialized` transitions, OR pull the
launch-screen logic out into a `<LaunchScreenGate />` component that
owns its own state.

---

### 7. AppShell auto-switch effects fight user actions

**Problem:** Three separate effects mutate `bottomTab` and panel-open
state behind the user's back:
1. `:240-245` — selecting a clip force-opens mixer + force-switches to
   "editor" tab.
2. `:248-255` — `onPanelShowAutomation` event force-opens mixer +
   switches to "automation".
3. `:258-262` — when the elastic-tab precondition disappears, switches
   to "editor".

User closes the mixer, then clicks a clip — mixer reopens. User picks
"setlist" tab, then clicks a clip — tab switches to "editor". Each
effect is plausible in isolation; together they make the dock feel
possessed.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:240-262`

**Needed:** Convert the auto-switch effects into explicit user actions
(only switch tab if the user hasn't manually picked one). Or stop
auto-opening the mixer; let "select clip" be a no-op with respect to
panel state. Document the policy in a comment.

---

### 8. Three-layer `bottomTab` chain is unmaintainable

**Problem:** `AppShell.tsx`'s `bottomTab` state has:
1. A 10-way string union literal (`:150-161`)
2. 10 buttons in a row, each with bespoke color class
3. A 10-arm chained ternary for panel content (`:712-732`)
4. A fallback to `<RoutingMatrix />` when `bottomTab` is unknown
   (silent regression risk)

Tab state is local React state, not persisted. Three effects mutate it.
Three more places need editing per new tab.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:150-161,599-697,712-732`

**Needed:** Extract a `BottomDockTabs` component with a registry:
`BOTTOM_TABS: Array<{ id, label, color, render: () => ReactNode,
condition?: () => boolean }>`. Iterate. Persist active tab in
`workspaceStore`. Use `satisfies` to ensure exhaustive switch.

---

### 9. Keyboard shortcut fragmentation across 7+ presentation files

**Problem:** `useGlobalKeyboardShortcuts` is meant to be the single
keyboard shortcut registry, but seven other presentation files attach
raw `window.addEventListener('keydown', …)`:
- `OnboardingTour.tsx:195` (Escape, arrow keys, Enter)
- `ShortcutCheatSheet.tsx:133` (`?`, Escape)
- `preferencesShared.tsx:81` (capture-phase: any key for "press a key")
- `ShortcutsSection.tsx:144` (capture-phase: any key)
- `AudioResumeOverlay.tsx:68` (any key resumes audio)
- `useAppInitialization.ts:75` (first key unlocks audio, `{ once: true }`)
- `WaveformEditor.tsx:309` (Escape)

Capture-phase listeners (preferencesShared, ShortcutsSection) fire
before the registry. Bubble-phase listeners fire after. None coordinate.
Concrete bug: pressing Escape during onboarding while a context menu
is open advances the tour AND closes the menu.

**Representative files:**

- See above.
- `src/modules/Command/presentations/views` (`useGlobalKeyboardShortcuts`)

**Needed:** Migrate every keyboard listener to register through
`useGlobalKeyboardShortcuts` (or its underlying
`Command/stores/shortcutStore`). For modal contexts (OnboardingTour,
ShortcutCheatSheet, capture-mode preferences), introduce a
"shortcut scope" concept — only one scope active at a time, scopes
suppress lower-priority listeners.

---

### 10. ResizeObserver inconsistencies and `viewportWidth` stale-on-first-frame

**Problem:** `ArrangeView.tsx:78` initializes `viewportWidth =
window.innerWidth`. The H-scrollbar uses `viewportWidth` to decide
whether content overflows. On first paint, `viewportWidth` is the full
window — much wider than the timeline column once side panels are
accounted for. Scrollbar appears/disappears once on mount.

`useLayoutEffect` re-runs on `hasUserTracks` flips (`:117`) — correct
intent, but the initial value is wrong, and the observer never
watches `window` (only `el`), so window resizes don't propagate.

Across the module, ResizeObserver destructure patterns vary:
- `LevelMeter.tsx:77` `(entries) => …`
- `AnalysisPanel.tsx:34` `([entry]) => …`
- `AutomationBottomPanel.tsx:62` `([entry]) => …`
- `ArrangeView.tsx:109` `() => …` (uses `el.clientWidth`)
- `RailTabBar.tsx:55` `() => requestAnimationFrame(…)` (good — RAF
  throttle)

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:78,104-117`
- `src/modules/Workspace/presentations/views/AnalysisPanel.tsx:34`
- `src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx:62`
- `src/modules/Workspace/presentations/views/Metering/LevelMeter.tsx:77`

**Needed:** (a) Initialize `viewportWidth` to 0 (or measure
synchronously inside `useLayoutEffect`) — never trust
`window.innerWidth` for an internal panel. (b) Standardise on a
`useResizeObserver(ref)` hook that returns `{width, height}` and
RAF-throttles updates. (c) Add a window-resize listener for layout
panels that span the full viewport, since RO doesn't fire on window
resize alone for non-document elements.

---

### 11. JSX `&&` rendering across many files (AGENTS.md violation)

**Problem:** AGENTS.md "Hard rules": "Never render with `&&` — use
ternaries or early returns." Many files use `{cond && (...)}`:

**Representative files:**

- `src/modules/Workspace/presentations/views/Sidebar/EffectsTab.tsx:251,273,386,421`
- `src/modules/Workspace/presentations/views/Inspector/TrackMidiFxSection.tsx:97,126,150`
- `src/modules/Workspace/presentations/views/Inspector/TrackHeaderSection.tsx:95`
- `src/modules/Workspace/presentations/views/Inspector/layouts/HammondB3Layout.tsx:71`
- `src/modules/Workspace/presentations/views/ClipView/PitchEditor.tsx:226,239,252`
- `src/modules/Workspace/presentations/views/Inspector/__tests__/ClipAudioAiSection.spec.tsx:107`
- `src/modules/Workspace/presentations/views/Inspector/__tests__/ClipInspector.spec.tsx:127`

**Needed:** Convert each `{cond && (…)}` to `{cond ? (…) : null}`.
Mechanical refactor. Add an ESLint rule
(`react/jsx-no-leaked-render` with mode `'always'`) to prevent
regression.

---

### 12. Render-time `setState` in `ArrangeView` syncing prop → local state

**Problem:** `ArrangeView.tsx:64-67,72-75` syncs an external
`workspaceState.trackListWidth` into local `useState` via a
"compare prev with ref, then setState during render" pattern. This is
React 19 official, but fragile — any consumer reading `localTrackListWidth`
during the same render gets the stale value (the new value flushes on
next render).

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:61-75`

**Needed:** Either remove the local copy (just use `trackListWidth`
directly + `setTrackListWidth(...)` on commit), or use
`useSyncExternalStore` and let React handle the subscription. The
local copy exists to debounce store writes during drag — that's a
legitimate need but should be implemented with a single
`useDeferredValue` or a debounced effect.

---

### 13. `useCases/index.ts` re-exports types — AGENTS.md violation

**Problem:** `useCases/index.ts:55`:
```
export type { Preferences, GridSnapOption, WorkspaceState, EditingTool } from './workspaceQueries/helpers';
```
AGENTS.md "Use-case types stay private": forbidden. Compounded by
`workspaceQueries/helpers.ts` re-exporting every model type at the top
(turning it into a secondary type barrel). Cross-module callers are
importing `WorkspaceState` through the use-case surface.

**Representative files:**

- `src/modules/Workspace/useCases/index.ts:55`
- `src/modules/Workspace/useCases/workspaceQueries/helpers.ts:1-32`

**Needed:** Drop the `export type` line. Audit cross-module callers
that import these types through useCases; have them define local
types per AGENTS.md "Model isolation".

---

### 14. Z-index ladder is uncoordinated; two overlays share `z-[10000]`

**Problem:** Hard-coded z values: `z-10`, `z-30`, `z-40`, `z-50`,
`z-[200]`, `z-[9999]`, `z-[10000]`. `OnboardingTour` and
`AudioResumeOverlay` both use `z-[10000]`; DOM order alone resolves
the conflict (AppShell renders OnboardingTour last so it wins). No
documented z-index scale.

**Representative files:**

- `src/modules/Workspace/presentations/components/ConfirmDialog.tsx:50` (`z-[200]`)
- `src/modules/Workspace/presentations/components/LaunchScreen.tsx:362` (`z-[9999]`)
- `src/modules/Workspace/presentations/components/MobileGate.tsx:41` (`z-[9999]`)
- `src/modules/Workspace/presentations/components/ProjectLoadingOverlay.tsx:43` (`z-[9999]`)
- `src/modules/Workspace/presentations/views/OnboardingTour.tsx:212` (`z-[10000]`)
- `src/modules/Workspace/presentations/views/AudioResumeOverlay.tsx:99` (`z-[10000]`)
- Many more `z-50` / `z-40` in popups.

**Needed:** Extract a `Z_INDEX` const (or Tailwind theme entry) with
named layers: `chrome` (10), `panel-overlay` (40), `popup` (50),
`dialog` (200), `boot-overlay` (9000), `audio-resume` (9050),
`onboarding-tour` (9100). Use named classes throughout. Ensure
`AudioResumeOverlay` is a strictly higher layer than `OnboardingTour`
(or the inverse — pick one and document why).

---

### 15. Skip-link focuses behind open dialogs

**Problem:** `AppShell.tsx:379-384` skip-link points to
`#main-content`. When a dialog is open (`PreferencesDialog`,
`ExportDialog`, `ConfirmDialog`, `AlphaNoticeDialog`), pressing the
skip-link scrolls focus to the main content **behind** the dialog.
AT users get focus-trapped behind the modal.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:379-384`

**Needed:** When any dialog is open, hide the skip-link or redirect
it to the dialog's first focusable element. Plumb modal-open state
into AppShell (or use a Radix/headless-ui pattern that handles focus
trapping automatically).

---

### 16. Bottom dock has no `role="tablist"` / `role="tabpanel"` semantics

**Problem:** `AppShell.tsx:584-734` renders a 10-tab dock with bare
`<Button>` components. No `role="tablist"`, `role="tab"`,
`aria-selected={...}`, or `role="tabpanel"`. AT users see 10 unrelated
buttons.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:589-697,710-732`

**Needed:** Wrap the tab bar in `<div role="tablist" aria-label="Bottom
dock">`. Buttons get `role="tab" aria-selected={bottomTab === id}`.
Panel container gets `role="tabpanel" id="..." aria-labelledby="..."`.

---

### 17. Reducer in `TimelineHScrollbar` works only by coincidence

**Problem:** `ArrangeView.tsx:217-223`:
```
const maxEndBeat = tracks.reduce((max, time) => {
    const trackMax = time.clips.reduce(
        (message, context) => (context.endBeat > message ? context.endBeat : message),
        max
    );
    return trackMax;
}, 256);
```
The outer reduce passes `max` as the inner accumulator's seed, and the
outer return is `trackMax` (not `Math.max(max, trackMax)`). Result is
correct only because the inner accumulator is seeded with `max` —
which makes the inner reduce equivalent to "compute the max across
all of this track's clips, lower-bounded by the running max." Renaming
or refactoring this without understanding the seed dependency will
silently break.

Also: variable names `time`, `message`, `context` for track,
accumulator, clip respectively — nonsensical (see issue #19).

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:217-223`

**Needed:** Rewrite as
```
const maxEndBeat = Math.max(
    256,
    ...tracks.flatMap((track) => track.clips.map((clip) => clip.endBeat)),
);
```
Or an explicit `for` loop with named variables.

---

### 18. `EmptyArrangeOverlay` swallows decode errors but leaves orphan tracks

**Problem:** `ArrangeView.tsx:298-318`. `addTrack` is dispatched first;
`decodeAudioFile(file)` is awaited; on decode failure the track stays.
User sees "import failed" toast plus a phantom empty track.

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:298-318`

**Needed:** Decode first, then `addTrack` + `addClip` only on success.
Or `removeTrack(newTrack.id)` in the catch block. Add a test for
"drop unsupported file" that asserts no track is created.

---

### 19. Variable-name pollution suggests bulk-rename

**Problem:** `ArrangeView.tsx` uses `time` for "track", `message` for
reduce accumulator, `context` for "clip". `useTracks().filter((time)
=> time.kind !== 'master' && time.kind !== 'folder')`. This pattern
appears across at least `ArrangeView.tsx`, `useStatusBarMetrics.ts`,
likely others. Looks like a careless find-replace.

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:59,217-220`
- (Likely many more — grep for `(time)` in lambdas across `presentations/`.)

**Needed:** Restore semantic names (`track`, `acc`, `clip`). Per user
memory `feedback_no_automated_bulk_edits`, this should not have
happened via codemod; do it as manual per-file edits. Audit the rest
of the module for similar damage.

---

### 20. Type-assertion escapes in tests

**Problem:** Many `as any` and `as unknown as` casts in spec files
hide partial fixtures or contract gaps:
- `Sidebar/__tests__/InstrumentsTab.spec.tsx:33-66` (×6 `as any`)
- `Sidebar/__tests__/SamplesTab.spec.tsx:35,48,61` (×3)
- `Sidebar/__tests__/effectsTabHelpers.spec.tsx:33`
- `Inspector/__tests__/DeviceInspector.spec.tsx:68-85` (×4)
- `views/__tests__/AutomationView.spec.tsx:46,65`
- `handlers/workspace/__tests__/handleSetWorkspaceMode.spec.ts:52` (`@ts-expect-error` no justification)
- `handlers/workspace/__tests__/workspaceMiscHandlers.spec.ts:61,73`
- `handlers/scratchPad/__tests__/scratchPadHandlers.spec.ts:30-61` (×5)
- `useCases/togglePanel/panelToggles/__tests__/dualView.spec.ts:22`
- `useCases/togglePanel/panelToggles/__tests__/toggleSidebar.spec.ts:39`
- `useCases/__tests__/setTrackHeight.spec.ts:24`
- `useCases/__tests__/setWorkspaceMode.spec.ts:14` (`null as any` from a function returning `WorkspaceState | null`)

The `scratchPadHandlers` casts (×5) suggest `workspaceStore.set` only
accepts full `WorkspaceState`, but tests want partial updates — that's
a legitimate API gap.

**Representative files:** see above.

**Needed:** Build typed test fixtures (`createTestWorkspaceState({ scratchPadOpen: true })`).
For `setWorkspaceMode.spec.ts:14`: type the mock as
`vi.mocked(getWorkspaceState).mockReturnValue(null)` directly — the
generic eats `null` if the signature returns `T | null`.

---

### 21. `AppShell` empty-state and dialogs lack ErrorBoundary

**Problem:** `<ErrorBoundary>` exists in
`presentations/components/ErrorBoundary.tsx` but is not used inside
`AppShell.tsx`. Each plugin panel renders bare. A throw in
`<FermenterPanel>` crashes the whole app. (User memory: "implement
error boundaries, fallback UIs, and graceful degradation".)

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:408-575`
- `src/modules/Workspace/presentations/components/ErrorBoundary.tsx`

**Needed:** Wrap each `<InstrumentBottomPanel>` body in
`<ErrorBoundary fallback={<DawBlockedState />}>`. Same for the
bottom-dock panel-content selector (lines 712-732). Same for lazy
panels.

---

### 22. `MobileGate` unmounts the entire tree on narrow viewport

**Problem:** `MobileGate.tsx:41` wraps the whole AppShell. If a
desktop user shrinks their window to < breakpoint, the entire app
tree unmounts — losing transient state, undo stack reachability,
selection, drag state, etc. There's no "I know — show me the desktop
UI anyway" escape.

**Representative files:**

- `src/modules/Workspace/presentations/components/MobileGate.tsx:41`
- `src/modules/Workspace/presentations/views/AppShell.tsx:377`

**Needed:** Either keep AppShell mounted and overlay the gate, or
add a "continue anyway" button that flips a localStorage flag.
Cross-reference: this gate is also shown to desktop users with
narrow browser windows — UX review required.

---

### 23. Lazy panels render `null` while loading

**Problem:** `AppShell.tsx:773-782`:
```
{collaborationPanelOpen ? (
    <Suspense fallback={null}>
        <CollaborationPanelLazy />
    </Suspense>
) : null}
```
User clicks "Open collaboration panel" on a slow network — sees nothing
for 1+ seconds, no spinner, no "loading…", just an unresponsive UI.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:773-782`

**Needed:** Replace `fallback={null}` with a panel-shaped skeleton or
a spinner.

---

### 24. `AppShell` `useEffect` dependency arrays elide derived deps

**Problem:** `:240-245` depends on `selectedClipId`. `:248-255`
depends on `mixerOpen`. Each effect mutates state that the other
reads. If both fire in the same commit, ordering matters but isn't
controlled. Example: select a clip while a panelShowAutomation event
fires — `bottomTab` ends up `'editor'` or `'automation'` depending on
microtask order.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:240-262`

**Needed:** Move auto-switch logic out of effects into the same
event/use-case that triggered the change, so ordering is explicit.

---

### 25. `EmptyArrangeOverlay` does sequential file imports

**Problem:** `ArrangeView.tsx:284-319` `for (const file of files) {
await … }` — drag-dropping 10 files imports them serially. Could
parallelise.

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:284-319`

**Needed:** `await Promise.all(files.map(processFile))`. Maintain
deterministic clip placement order via the original `files` index, not
completion order.

---

### 26. `TimelineHScrollbar` calls `setScrollX` per mousemove without RAF
throttle

**Problem:** `ArrangeView.tsx:241-245` `setScrollX(...)` runs on every
`mousemove`. `setScrollX` writes to `timelineViewStore`, which fans out
to every track row, ruler, marker lane, etc. ~60 Hz mouse events
pushing through a heavy subscriber tree.

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:241-244`

**Needed:** Wrap the move handler in `requestAnimationFrame` throttle
(set `scrollX` once per frame).

---

### 27. `bottomTab` is local React state, not persisted

**Problem:** Tab choice is `useState`, lost on reload. Inconsistent
with other panel state that lives in `workspaceStore`.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:150-161`

**Needed:** Move to `workspaceStore` as `bottomDockTab: BottomTabId`.

---

### 28. `workspaceStore.set` requires full state — tests cast partials

**Problem:** Five `as any` casts in `scratchPadHandlers.spec.ts`
(`workspaceStore.set({ scratchPadOpen: false } as any)`) plus more in
`dualView.spec.ts`, `toggleSidebar.spec.ts`, `setTrackHeight.spec.ts`.
The store API only accepts full state; tests want partial updates.

**Representative files:**

- `src/modules/Workspace/handlers/scratchPad/__tests__/scratchPadHandlers.spec.ts:30,35,43,55,61`
- `src/modules/Workspace/useCases/togglePanel/panelToggles/__tests__/dualView.spec.ts:22`
- `src/modules/Workspace/useCases/togglePanel/panelToggles/__tests__/toggleSidebar.spec.ts:39`

**Needed:** Add a `partialUpdate(partial: Partial<WorkspaceState>)`
helper or test fixture
`createTestWorkspaceState(overrides?: Partial<WorkspaceState>)`. Drop
the `as any`.

---

### 29. `getAdjustmentLayerStripHeight(count)` couples height to count

**Problem:** `ArrangeView.tsx:170` calls
`getAdjustmentLayerStripHeight(adjustmentLayerCount)` — implies all
layers have equal height. If Arrangement ever introduces variable-height
layers, the track-list `extraHeaderHeight` silently drifts.

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:170`
- (Function definition lives in `Arrangement/presentations/views`.)

**Needed:** Pass the actual `layers` array so the function can sum per-layer heights, OR introduce a "lane height registry" exposed by Arrangement that ArrangeView consumes once. Add a test asserting
track-list header height equals timeline-chrome height after each
chrome change.

---

### 30. `useAppInitialization`'s keydown listener with `{ once: true }`
leaks if AppShell unmounts before any key press

**Problem:** `useAppInitialization.ts:75` registers a global keydown
listener with `{ once: true }`. Auto-removes after one fire. But if
the AppShell unmounts (HMR, route swap) before any key is pressed,
the listener stays attached, holding a closure over the old store
references. Next key press resumes the (now-stale) audio context.

**Representative files:**

- `src/modules/Workspace/presentations/hooks/useAppInitialization.ts:75`

**Needed:** Add an explicit cleanup: store the handler in a ref,
return a cleanup that calls `removeEventListener`.

---

### 31. No central panel-layout invariant test

**Problem:** Track-list header alignment with timeline chrome depends
on a sum across `ARRANGEMENT_BAR_HEIGHT`,
`getAdjustmentLayerStripHeight(count)`, `MARKER_LANE_HEIGHT`,
`MINIMAP_HEIGHT`, `BEAT_RULER_HEIGHT`, `CHORD_TRACK_LANE_HEIGHT`.
There is no test asserting their sum equals the actual rendered top
padding, nor a visual regression test.

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:168-176`

**Needed:** Add a unit test that mounts ArrangeView with markers/chord
toggled on/off and asserts the rendered `extraHeaderHeight` equals the
sum of all visible chrome lane heights. Or a Playwright visual test
that asserts pixel-perfect alignment between the track list and the
first timeline lane.

---

### 32. `panelToggles/` directory has 22 one-line files

**Problem:** `useCases/togglePanel/panelToggles/` contains 22 files,
each exporting one toggle function. Many are 5-10 lines. AGENTS.md
"One Function Per File" applies to `useCases/` — already satisfied,
but the directory is a maintenance smell.

**Representative files:**

- `src/modules/Workspace/useCases/togglePanel/panelToggles/` (22 files)

**Needed:** Out of scope for "real problems only" — leave for now.
Note as deferred cleanup.

---

### 33. `AppShell` Suspense fallback for lazy panels is `null`

(Subset of #23; kept separate for tracking.)

---

### 34. Onboarding effect's `trackStore.value?.tracks` access is unsafe
on first render

**Problem:** `AppShell.tsx:215`
`trackStore.value?.tracks.length ?? 0`. The optional-chain on
`trackStore.value` plus `.tracks` (no chain) means if `value` is null,
the chain stops; if `value` is the empty store snapshot
`{ tracks: [] }`, `.tracks` is fine. But a future store refactor that
makes `value: { tracks?: Track[] }` would NPE here without the chain.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:215`

**Needed:** Use a typed read helper (e.g. `getTrackStoreSnapshot()`)
or assert the contract.

---

### 35. Drag-and-drop has no central type registry

**Problem:** Drop handlers are scattered (Sidebar, Inspector, ArrangeView).
Each re-implements MIME / file-type detection (e.g.
`['mid', 'midi'].includes(ext) || file.type === 'audio/midi'` in
ArrangeView). No shared "drag-effect" registry.

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:284-319`
- (Multiple Sidebar/Inspector files — out of scope for full enumeration.)

**Needed:** Introduce a `dragMime.ts` helper module with
`detectFileKind(file): 'audio' | 'midi' | 'unknown'`. Replace inline
checks. Cross-reference with Arrangement audit if it covers the
sample drag path.

---

### 36. `AppShell` imports from 18+ cross-module barrels

**Problem:** Lines 8-30 + 60-65 + 72: imports from AiGeneration,
AudioEngine, AiRuntime, Automation, Bacteria, Command, Crumbs, Crust,
Fermenter, Gluten, GrandBoule, Grinder, Levain, Plugin, Toaster,
Transport, Proof, Scoring, Yeast, VirtualKeyboard, Project,
Collaboration, CrdtDocument. Twenty-three modules. Correct in DDD
terms (root-barrel imports), but a smell — AppShell is the
integration point for the entire app.

**Representative files:**

- `src/modules/Workspace/presentations/views/AppShell.tsx:8-97`

**Needed:** Consider a `<PluginPanelRegistry>` extension point that
each plugin module subscribes to (instead of AppShell hard-coding
each plugin's panel).

---

### 37. `AnalysisPanel.tsx:49` uses `&&` in a render-prop

**Problem:** `{size.width > 0 && size.height > 0 ? children(size) : null}`
— ternary surrounding a `&&` chain. The `&&` chain is fine here
(both sides are booleans, ternary picks the result), so this is
NOT a leaked-render bug. False alarm — but the inner `&&` should
still be replaced for consistency.

**Representative files:**

- `src/modules/Workspace/presentations/views/AnalysisPanel.tsx:49`

**Needed:** Rewrite as `size.width > 0 && size.height > 0` outside
JSX, then ternary.

---

### 38. `preferencesStore` does shallow merge; corrupted storage can
inject `null`

**Problem:** `stores/preferencesStore.ts:11-14`. No runtime validation
of the stored shape. If `localStorage['sourdaw-preferences']` contains
`{ theme: null }`, the merge produces `{ ..., theme: null }` and every
consumer reads `null`.

**Representative files:**

- `src/modules/Workspace/stores/preferencesStore.ts:8-15`
- `src/modules/Workspace/models/Preferences.ts`

**Needed:** Add a Zod schema (`PreferencesSchema`) and validate on
load. Fall back to defaults on validation failure with a `console.warn`.

---

### 39. `ArrangeView` viewportWidth initializer is `window.innerWidth`

**Problem:** See #10 + #42. On first paint the H-scrollbar's
overflow check uses the full window width, not the timeline column's
width. The scrollbar visibly toggles on mount.

**Representative files:**

- `src/modules/Workspace/presentations/views/ArrangeView.tsx:78`

**Needed:** Initialize to 0; rely on the `useLayoutEffect` to set
the real value before paint. (Or measure synchronously inside the
ref callback.)

---

### 40. Multiple files have `&&` rendering patterns; AGENTS.md violation

(See issue #11 — kept here as the umbrella priority.)

---

### 41. `renderIife_N` codemod artifacts pollute presentations

**Problem:** A previous code transformation appears to have replaced
inline IIFE expressions (`{(() => { ... })()}`) with named functions —
but the names are auto-generated like `renderIife_1`, `renderIife_4`,
`renderIife_5`, `renderIife_6`, `renderIife_7`, `renderIife_8`,
`renderIife_9`, `renderIife_10`, `renderIife_13`, `renderIife_22`. They
appear across at least 7 files (8+ occurrences):

- `presentations/components/NotificationToast.tsx:20,34`
- `presentations/views/StatusBar.tsx:75,125`
- `presentations/views/PromptBar.tsx:151,170,181,222,236,256` (×3 functions, ×3 sites)
- `presentations/views/InspectorPanel.tsx:40,115`
- `presentations/views/AutomationBottomPanel.tsx:221,327`
- `presentations/views/SessionView.tsx:60,110,119,121,144,161` (×4 functions in one file)

The numbers are global / per-codemod-run counters (e.g. `_13` in
StatusBar but `_1` in NotificationToast). The names are meaningless
and tell the reader nothing about what each function returns. AGENTS.md
"Code should self-explain" + user memory `feedback_code_should_self_explain`:
"comments signal hacks; rewrite code to be self-evident". And per
user memory `feedback_no_automated_bulk_edits`: never use codemods/sed
to edit multiple files. Whichever transform produced these names was
not surfaced to the user.

In `StatusBar.tsx:75-95`, `renderIife_13` is also a nested if/else
chain with three levels of nesting and no early return — should be a
guard-clause sequence per AGENTS.md (`docs/07-conventions.md`).

In `SessionView.tsx`, four `renderIife_*` functions are nested inside
each other (`_8` defined inside `_7`'s scope at `:110`, `_9` inside
`_7` at `:119`, `_10` inside `_9` at `:121`). Each render call
re-allocates four closures.

**Representative files:**

- See above (8 files, 17+ occurrences).

**Needed:** Manually rename each `renderIife_N` to a descriptive name
(`renderLlmStatus`, `renderInspectorContent`, `renderClipMarker`, …)
or inline as a ternary. Per user memory: do this as manual per-file
Edit operations, not via a script.

---

### 42. `(time)` lambda parameter for "track" / "tag" / "clip"

**Problem:** Across 30+ sites in `presentations/`, `.filter`/`.find`/`.map`
lambdas use `(time)` as the parameter name where the value is a
`Track`, `Tag`, or `Clip`. Examples:

- `usePianoRollRenderer.ts:441` `tracks.filter((time) => time.kind === 'midi' …)`
- `useSelectionLabel.ts:21` `trackStore.value?.tracks.flatMap((time) => time.clips)`
- `useAppInitialization.ts:41` `.flatMap((time) => time.clips.map((context) => context.audioBufferId))` — `time` is track, `context` is clip
- `usePromptExecution.ts:130,141,153` (3 sites)
- `MixerPanel.tsx:95,206`
- `InspectorPanel.tsx:29,32`
- `AutomationBottomPanel.tsx:131`
- `ClipView.tsx:24,63`
- `ArrangeView.tsx:59,217-220` — `(time)` for track, `(message, context)` for reduce
- `RoutingMatrix.tsx:38,39` `tracks.filter((time: Track) => …)`
- `RoutingGraph.tsx:49-51` (3 sites)
- `Sidebar/InstrumentsTab.tsx:127,192,199,206,240` (5 sites)
- `Sidebar/EffectsTab.tsx:72`
- `usePianoRollInteractions.ts:1140`
- Some legitimate uses where `time` actually is a timestamp:
  `useTempoEditorState.ts:166` (taps), `Wavetable3D.tsx:27`. Those
  are correct.

This is bulk-rename damage from a careless codemod (probably a
"don't shadow `track`" rule applied without context).

**Representative files:** See above.

**Needed:** Manual per-file restoration of semantic names (`track`,
`tag`, `clip`). Per user memory: do this via Edit tool, one file at
a time, no scripts.

---

### 43. Per-device panel events have a "deprecated parallel API"

**Problem:** `useCases/panels/devicePanels/` has 13 deprecated
`@deprecated` files alongside their canonical replacements:

- `showFermenterPanel.ts` (none — actually canonical) vs.
  `onPanelShowFermenter.ts` `@deprecated Use {@link onShowDevicePanel}`
- `showCrustPanel.ts:4` `@deprecated Use {@link showDevicePanel}`
- `showGlutenPanel.ts:4` `@deprecated`
- `showScoringPanel.ts:4` `@deprecated`
- `showAutomationPanel.ts:4` `@deprecated`
- `showGrandBoulePanel.ts:4` `@deprecated`
- `onPanelShowFermenter.ts:8` `@deprecated`
- `onPanelShowToaster.ts:6` `@deprecated`
- `onPanelShowDutchOven.ts:6` `@deprecated`
- `onPanelShowProof.ts:6` `@deprecated`
- `onPanelShowBacteria.ts:6` `@deprecated`

But `presentations/hooks/useActiveDevicePanel.ts:69-85` still uses
the deprecated `onPanelShow{Fermenter,Toaster,Levain,DutchOven,
Gluten,Bacteria,Proof,Yeast,Scoring,Crust,Crumbs,GrandBoule}` and
only uses `onShowDevicePanel` for **grinder** (lines 75-79). The
deprecated code path is the production path for 12 of 13 plugins.

Compounded with issue #4: deprecating per-device events is a step
toward the registry pattern that issue #4 calls for, but the
migration is half-done.

**Representative files:**

- `src/modules/Workspace/useCases/panels/devicePanels/onPanelShow*.ts`
- `src/modules/Workspace/useCases/panels/devicePanels/show*Panel.ts`
- `src/modules/Workspace/useCases/panels/devicePanels/onShowDevicePanel.ts`
- `src/modules/Workspace/useCases/panels/devicePanels/showDevicePanel.ts`
- `src/modules/Workspace/presentations/hooks/useActiveDevicePanel.ts:68-101`

**Needed:** Finish the migration. Replace the 12 `onPanelShow*` calls
with a single `onShowDevicePanel` filter switch. Delete deprecated
files (per user instruction — surface here, don't delete unilaterally).
Wire issue #4's registry to the same generic event.

---

### 44. `useActiveDevicePanel.ts:66` uses `as ActiveDevicePanel` cast

**Problem:** `useActiveDevicePanel.ts:66`:
```
setActivePanel({ kind, deviceId: param.deviceId, trackId: currentTrackId() } as ActiveDevicePanel);
```
The cast is needed because TypeScript can't narrow `kind: NeedsDeviceId`
to a single literal in the union. Per AGENTS.md "TypeScript — soundness"
this `as` cast hides a real type-level problem (the discriminated
union has a literal-string discriminator but `kind` is the broad
`NeedsDeviceId` here).

**Representative files:**

- `src/modules/Workspace/presentations/hooks/useActiveDevicePanel.ts:61-67`

**Needed:** Rewrite `openForKind` to use a generic that locks `kind`:
```
const openForKind = <Kind extends NeedsDeviceId>(kind: Kind) =>
    (param: { deviceId: string | null }) => { ... };
```
The returned object can then be typed correctly per `Kind`. Or use a
discriminated factory.

---

### 45. `repositories/workspace.ts` ships two functions in one file

**Problem:** AGENTS.md "One Function Per File" applies to
`repositories/`. `repositories/workspace.ts` exports both
`getWorkspaceState` and `updateWorkspaceState`.

**Representative files:**

- `src/modules/Workspace/repositories/workspace.ts:4,8`

**Needed:** Split into `repositories/getWorkspaceState.ts` and
`repositories/updateWorkspaceState.ts`. Update imports.

---

### 46. `updateWorkspaceState` silently no-ops if store is empty

**Problem:** `repositories/workspace.ts:9-12`:
```
const current = workspaceStore.value;
if (!current) {
    return;
}
```
If `workspaceStore.value` is null, the patch is silently dropped — no
error, no warning. Caller sees a successful no-op. The store is
initialized synchronously with `defaultWorkspaceState` (`workspaceStore.ts:58`)
so `value` is never null at runtime, but the type
`createStore<WorkspaceState>` returns `WorkspaceState | null` — this
defensive code path papers over a real type-system gap (the store
shouldn't admit null after construction).

**Representative files:**

- `src/modules/Workspace/repositories/workspace.ts:9-12`
- `src/modules/Workspace/stores/workspaceStore.ts:58`

**Needed:** Audit the store API — if a store always has a value after
init, the type should reflect that (or the caller asserts it once).
Replace the silent return with `throw new Error('workspaceStore not initialized')`
in dev (acts as an invariant assertion).

---

### 47. SessionView slot-launch is non-functional (UI-only)

**Problem:** `stores/sessionLaunchStore.ts:11-13` admits in a comment:
> "Wiring slot launches through to the audio engine (so launching a
> slot actually triggers clip playback) is tracked as follow-up feature
> work — this store only fixes the UI data-loss bug."

`SessionView.tsx:32-50` `handleLaunchSlot` / `handleLaunchScene` /
`handleStopAll` write only to `sessionLaunchStore` — the UI flips
visual state but **nothing plays**. Users see a launch grid that looks
like Ableton's Session view but doesn't trigger the clips. No
notification or visual indicator tells users this is non-functional.

**Representative files:**

- `src/modules/Workspace/stores/sessionLaunchStore.ts:6-12`
- `src/modules/Workspace/presentations/views/SessionView.tsx:32-50`

**Needed:** Either implement the audio-engine wiring (call `Transport`/
`Arrangement` use cases to actually launch clips) or hide the
SessionView tab until the feature is real. Shipping a "Launch" button
that doesn't launch is misleading-by-construction.

---

### 48. SessionView grid uses `Object.values(track.clips)[index]` for the
clip-per-slot mapping

**Problem:** `SessionView.tsx:92-94`:
```
const trackClipIds: Array<string | null> = Array.from({ length: SCENE_COUNT }, (_, index) => {
    const clips = track.clips ? (Object.values(track.clips) as Array<{ id: string }>) : [];
    return clips[index]?.id ?? null;
});
```
`track.clips` is an **array**, not a record (per `Track.clips` in
`Arrangement/models`). `Object.values(array)` returns the array's
elements, so the result is the same as `track.clips`. But the code
indexes by scene index — which means scene 1 = first clip in array,
scene 2 = second, etc. There is no notion of which clip belongs to
which slot. If clips are reordered, scene assignments scramble.
Also the `as Array<{ id: string }>` cast is an AGENTS.md violation.

**Representative files:**

- `src/modules/Workspace/presentations/views/SessionView.tsx:92-94`

**Needed:** Either model "session slots" as a separate first-class
data structure on tracks (each clip gets a `slotIndex: number | null`),
or wire the SessionView to Arrangement's actual clip layout. Drop the
cast.

---

### 49. SessionView nests four `renderIife_*` closures three levels deep

**Problem:** `SessionView.tsx:60-202`. `renderIife_7` is the outer
function. Inside the inner `tracks.map`, three more `renderIife_8`,
`renderIife_9`, `renderIife_10` are declared. `renderIife_10` is
declared **inside** `renderIife_9`'s `if (clipId) { … }` block. Each
render iteration through `track × scene` re-allocates 3 closures per
cell. With `SCENE_COUNT = 16` (or whatever) and N tracks, that's
3 × 16 × N closures per render.

The original code was IIFEs `(() => { ... })()` which the codemod
converted to named declarations. The semantic is identical but the
allocations now have stable names that imply they're "real"
functions.

**Representative files:**

- `src/modules/Workspace/presentations/views/SessionView.tsx:60,110,119,121,144,161`

**Needed:** Inline as ternaries (per AGENTS.md, avoiding chained ones)
or extract to top-level helper functions named for what they return
(`getCellBackground(clipId, isActive, trackColor)`, etc.).

---

### 50. `StatusBar.tsx:75-95` has nested if/else chain (no guard clauses)

**Problem:** `renderIife_13` is a 3-level nested if/else that violates
AGENTS.md `docs/07-conventions.md` "Guard clauses / early returns
ONLY. No chained ternaries." This is not a chained ternary, but the
4-arm nested if/else is the same anti-pattern. Should be a switch on
`llmStatus.state` or guard clauses.

**Representative files:**

- `src/modules/Workspace/presentations/views/StatusBar.tsx:75-95`

**Needed:** Rewrite as guard clauses:
```
if (llmStatus?.state === 'generating') return …;
if (llmStatus?.state === 'loading') return …;
if (llmStatus?.state === 'ready') return …;
return … /* idle */;
```

---

## Open questions

- [ ] Is the absence of root `index.ts` historical (the module
      pre-dates the convention) or intentional? If intentional, document
      the exception in AGENTS.md.
- [ ] Should `bottomTab` be persisted in `workspaceStore`? UX call.
- [ ] Are the auto-switch effects (selectedClipId → editor tab + open
      mixer) intentional UX or accidents? Talk to design.
- [ ] What's the policy on `MobileGate`'s "no escape" behavior on
      narrow desktop windows?
- [ ] Does the "drag a clip from PianoRoll to Arrangement" path exist
      (issue #59) or is it not in scope?
- [ ] Does the `Arrangement` module's chrome-height export (`getAdjustmentLayerStripHeight`) need to evolve to a per-layer
      height function (issue #29)?

---

## Risks

- **User-fighting UI.** Issues #6, #7, #8, #9, #19: render-time setState,
  auto-switch tabs, fragmented keyboard listeners. Combined effect:
  panel state changes the user didn't ask for, shortcuts that fire
  twice, occasional "Cannot update component while rendering" crashes
  under StrictMode.
- **Drift across duplicated state defaults.** Issues #2, #3: two
  copies of `defaultWorkspaceState` and two copies of
  `defaultPreferences`. A future PR that adds a field to one will
  silently miss the other.
- **Maintenance tax per new plugin.** Issue #4: each new device panel
  touches 5 places. Over 14 plugins, this has produced ~500 lines of
  AppShell that could be ~50.
- **Architectural drift.** Issues #1, #13, #14, #15: missing root
  `index.ts`, type re-exports across `useCases/`, no z-index ladder,
  partial cross-module coupling via `workspaceQueries/helpers.ts`.
  Each one normalises the next bend in the rules.
- **Coincidental correctness.** Issue #17: the H-scrollbar's reducer
  works only because the inner accumulator is seeded with the outer
  max. A refactor renaming or reordering this will silently produce
  wrong widths.
- **Accessibility regressions.** Issues #15, #16: skip-link focuses
  behind dialogs, bottom dock has no tablist semantics. AT users
  experience the app as a wall of buttons with focus traps.
- **HMR / unmount leaks.** Issues #5 (orphan file in source tree),
  #30 (`{ once: true }` listeners that don't auto-cleanup on
  unmount), the seven scattered `keydown` listeners.

---

## Suggested approaches

- **Land the structural cleanup first.** Issue #1 (root `index.ts`),
  #2 + #3 (deduplicate defaults), #5 (delete orphan file), #13
  (drop type re-exports). Mechanical, ~half a day, unblocks AGENTS.md
  compliance for the rest.
- **Extract a `<DevicePanelDock>` component + registry.** Issue #4 +
  #20 + #21 + #22. Replace 14 fields, 14 union branches, 14 JSX blocks
  with a single registry. Big LoC win, big maintainability win.
- **Fix render-time setState and auto-switch effects.** Issues #6, #7,
  #12, #54. The launch screen state machine becomes a `<LaunchGate>`
  child component that owns `showLaunch`/`exiting` internally and
  reacts to `project` via effects. The auto-switch logic moves into
  the user-action handler that triggered the underlying change.
- **Migrate scattered keyboard listeners to the Command shortcut
  registry.** Issue #9, #28, #44. Define `shortcutScopes`. Modal
  components push a scope; popping pops listeners. Replace seven
  `window.addEventListener('keydown', …)` sites with
  `registerShortcut(scope, key, handler)`.
- **Build a z-index ladder.** Issue #14. One `Z_INDEX` const. Replace
  every hard-coded `z-50` / `z-[10000]`. Same with timeline chrome
  heights (issue #29) — make it a registry.
- **Add visual regression tests** for the timeline-chrome alignment
  (issue #31). Playwright + pixel diff against `extraHeaderHeight`
  drift.
- **Rename misnamed reduce variables.** Issue #19 — manual per-file
  edits, no codemod.
- **Type-soundness pass on tests.** Issue #20, #28. Replace every
  `as any` / `as unknown as` with proper fixtures or store-API
  changes.

---

## Recommendation

Start with **issues #47 + #48** (SessionView is non-functional). Either
gate the Session tab behind a feature flag or ship the audio-engine
wiring. Shipping a UI that pretends to launch clips erodes user trust
and is likely to surface as bug reports against unrelated code.

Run **issues #1, #2, #3, #5** in parallel (deduplications + orphan
file). Mechanical, each takes minutes.

Then prioritise **issues #41 + #42** (codemod artifact cleanup). Per
user memory, these must be done by hand, one file at a time. There
are ~8 files with `renderIife_N` and ~15 files with `(time)` lambdas
— budget a session per area.

After that, tackle **issue #4** (the 14-panel sprawl) consolidated with
**#43** (deprecated panel events). One `<DevicePanelDock>` driven by a
registry, talking to one canonical `onShowDevicePanel` event, replaces
14 fields × 14 union branches × 14 JSX blocks × 13 deprecated event
files. Largest LoC win in the audit.

Then **issues #6 + #7** (render-time setState + auto-switch effects)
— the most user-visible bad behavior and easiest to verify post-fix.

Then **issue #17** (TimelineHScrollbar reducer) — small, isolated bug
fix that has been hiding in plain sight.

The rest (keyboard fragmentation, z-index ladder, lazy-load skeletons,
test type soundness, ARIA semantics) can be sequenced in any order.

---

## Resolved

_No issues resolved yet._
