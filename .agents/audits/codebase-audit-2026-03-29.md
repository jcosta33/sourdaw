# Sourdaw Codebase Audit — 2026-03-29

Focused on structural problems, UI duplication, UX inconsistencies, design system violations, and performance issues.
Not concerned with logging patterns, event bus wiring, or console output.

---

## Priority Legend

- **P0** — Bug / broken feature / data loss risk
- **P1** — Significant structural debt or UX failure affecting daily use
- **P2** — Design system violation or noteworthy inconsistency
- **P3** — Minor cleanup / polish

---

## P0 — Bugs / Broken Features / Data Loss Risk

### 1. Keyboard Delete bypasses undo history

**File:** `src/modules/Workspace/presentations/hooks/useAppKeyboardShortcuts.ts:84-98`

When clips are deleted via the `Delete`/`Backspace` key, `removeClip()` is called directly with no undo entry pushed. Some context-menu paths (`ClipContextMenu` split, `MixerPanel` recall) _do_ push undo entries. The inconsistency means a keyboard-triggered mass delete is irrecoverable. Fix: wrap the keyboard delete path in `pushUndoEntry(...)` just like the split-clip path.

---

### 2. Orchestral instruments visible but fully silent

**File:** `src/modules/Plugin/presentations/views/OrchestraPanel.tsx` (referenced in `InstrumentsTab.tsx`)

Only "Solo Violin" has working samples. All other orchestral instruments appear in the UI, are selectable, and trigger no audio, no error toast, and no "coming soon" indication. Users will spend time debugging silence. Fix: either implement them, or add `disabled` state with a tooltip/unimplemented badge (similar to the `UnimplementedBadge` already used in `EffectsTab`).

---

### 3. Delete Track in context menu has no confirmation

**Files:** `TrackContextMenu.tsx:194-200`, `ExpandedChannelStrip.tsx:398-405`

`removeTrack(track.id)` is called immediately with no dialog. A misclick in the context menu destroys the track and all its clips. `TrackListView` does use `window.confirm()` for keyboard-triggered deletes (line 147), but the context menu paths don't. This inconsistency means the safer path (keyboard) has friction, while the easier path (mouse) has none. Fix: use a Shadcn `AlertDialog` consistently in all delete paths.

---

### 4. `window.prompt` used for clip rename

**File:** `ClipContextMenu.tsx:108-117`

The "Rename Clip" menu item calls `window.prompt(...)` — a blocking native dialog that doesn't integrate with the app's design, doesn't respect keyboard shortcuts, and breaks on some platforms. Every other rename flow in the codebase uses an inline `<input>` (TrackContextMenu, ArrangementBar, MacrosPanel, ExpandedChannelStrip). Fix: implement an inline editing input inside the ClipContextMenu, consistent with the rest of the app.

---

### 5. `TrackListView.tsx` has a mid-file import

**File:** `src/modules/Arrangement/presentations/views/TrackListView.tsx:272`

```ts
import { getTrackTemplates, loadTrackTemplate } from '../../useCases/trackTemplate';
```

This import is placed mid-file, after the component export, inside the file body. It only works because JS hoists module imports before execution, but it's confusing, violates convention, and will fool any linting rule that enforces top-of-file imports. Fix: move to the top of the file.

---

## P1 — Significant Structural Debt / UX Failures

### 6. Copy-pasted bottom panel chrome in AppShell

**File:** `src/modules/Workspace/presentations/views/AppShell.tsx` (Fermenter, Toaster, and Levain bottom panel blocks)

Three nearly identical JSX blocks each containing: `DragResizeHandle`, a container `div` with border/bg, a header row with label + close `Button`, and the inner panel component. Only the accent color, label, height state variable, and rendered component differ. The `InstrumentBottomPanel` component already exists at `presentations/components/InstrumentBottomPanel.tsx` and is clearly designed to be reused, but AppShell is not using it. Fix: each block should be `<InstrumentBottomPanel ...>`.

---

### 7. `NavCard` reimplemented inline in InstrumentsTab

**Files:** `effectsTabHelpers.tsx:116-163` (canonical definition), `InstrumentsTab.tsx` (manual reimplementation of the same pattern for instrument category buttons)

The category cards in InstrumentsTab (Synths, Sampler, etc.) duplicate the same `button > icon-box + label + description + count + ChevronRight` structure defined in `NavCard`. Minor visual differences (opacity on text) are not reason enough to fork it. Fix: import `NavCard` from `effectsTabHelpers`, pass any needed `dimmed` prop.

---

### 8. Panel dimension state has two sources of truth

**Files:** `AppShell.tsx:~156-166` vs `WorkspaceState.ts`

AppShell tracks `sidebarWidth`, `inspectorWidth`, `mixerHeight`, `chatPanelWidth` in local `useState`. The `WorkspaceState` store also has these fields. During resize, the local state updates but the store update only happens on `onResizeEnd`. Any component outside AppShell reading from `useWorkspaceState()` during an active drag gets a stale value. Fix: drive resize directly through the store (store already handles the value, AppShell should only read from it, syncing via a throttled write during drag at most).

---

### 9. `AddTrackMenu` re-implements click-outside popover instead of using Shadcn

**File:** `src/modules/Arrangement/presentations/views/TrackListView.tsx:274-376`

`AddTrackMenu` uses `document.addEventListener('mousedown', ...)` to handle click-outside, manual popover positioning, and `useState` for open state. This hand-rolled popover pattern is replicated in ~4 other places. Shadcn's `DropdownMenu` or `Popover` already handles all of this correctly, including focus management, keyboard dismissal, and portal positioning. Fix: replace with `DropdownMenu`.

---

### 10. Four separate hand-rolled context menu dismiss implementations

**Files:**

- `ExpandedChannelStrip.tsx:56-76` — `useEffect` + `document.addEventListener` for mousedown+keydown
- `TrackContextMenu.tsx:49-60` — same (escape key only)
- `ArrangementBar.tsx:86-97` — same pattern
- `MixerPanel.tsx:~134-182` — inline snapshot picker popover (same pattern)

Each reinvents click-outside / escape dismissal. `ClipContextMenu` is the only one that correctly uses the shared `useContextMenuDismiss` hook from `presentations/hooks/`. All other context menus should use that same hook or be migrated to Radix `ContextMenu` / `DropdownMenu`.

---

### 11. Metronome volume slider: raw `<input type="range">` in Transport vs Shadcn `<Slider>` in Preferences

**Files:** `TransportControls.tsx:208-226`, `PreferencesDialog.tsx:213-227`

Two controls for metronome volume. The one in TransportControls is a bare `<input type="range">` with a massive inline pseudo-element selector string (`[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2...`). The one in PreferencesDialog correctly uses `<Slider>`. Fix: replace the raw input in TransportControls with `<Slider>` to remove ~60 characters of inlined CSS pseudo-selectors from JSX.

---

### 12. `TransportControls` uses `useEffect` for data fetching (Ableton Link status)

**File:** `TransportControls.tsx:51-55`

```ts
useEffect(() => {
    getLinkStatus()
        .then((status) => setLinkEnabled(status.enabled))
        .catch(() => {});
}, []);
```

This violates the project's state management rules (no `useEffect` for data fetching). It also runs only once on mount; if Link state changes externally, the UI won't update. Fix: expose link status through a store that the engine updates, subscribe via `useSyncExternalStore`.

---

### 13. `clamp()` utility defined inline in multiple files

The `clamp(v, min, max)` utility is defined inline in at least:

- `AppShell.tsx`
- `ArrangeView.tsx`
- `InstrumentBottomPanel.tsx`

A shared `clamp` should live in `src/helpers/` and be imported where needed.

---

### 14. `MixerPanel` snapshots stored in local `useState`, not derived from store

**File:** `MixerPanel.tsx:41`

```ts
const [snapshots, setSnapshots] = useState<MixerSnapshot[]>(getMixerSnapshots);
```

After each save/delete/rename, the component manually calls `setSnapshots(getMixerSnapshots())`. This is fragile — if any other consumer modifies snapshots (e.g., an AI action), the component won't update. Fix: expose a snapshot store or derive from an existing store reactively.

---

### 15. `PreferencesDialog.tsx` is 525 lines — mounts all sections in one file

**File:** `PreferencesDialog.tsx`

Seven section components all live in one file. While only one renders at a time, the file is too large to navigate. Fix: extract each section into its own file in `presentations/views/Preferences/`.

---

### 16. `InstrumentCard` LEVAIN_THEME bypasses the design token system

**File:** `presentations/components/sidebar/InstrumentCard.tsx:38-44`

```ts
export const LEVAIN_THEME: InstrumentCardTheme = {
    button: 'border-amber-500/30 ...',
    iconBox: '... shadow-[0_0_12px_rgba(245,158,11,0.15)]',
    iconColor: 'text-amber-400',
    ...
};
```

`FERMENTER_THEME` and `TOASTER_THEME` correctly use `var(--color-accent-lavender)` and `var(--color-accent-peach)`. LEVAIN uses raw Tailwind `amber-*` classes and a hardcoded RGBA shadow. If `--color-accent-amber` is adjusted in `main.css`, the Levain card won't update. Fix: add `--color-accent-amber` to the design system surface aliases and use it here.

---

## P2 — Design System Violations / Inconsistencies

### 17. Empty state styling is inconsistent across all tabs (six distinct patterns)

| Location                | Text size               | Opacity      | Padding            | Wrapper     |
| ----------------------- | ----------------------- | ------------ | ------------------ | ----------- |
| InstrumentsTab search   | `text-[9px]`            | `/50`        | `py-6`             | plain div   |
| InstrumentsTab category | `text-xs`               | none         | `py-10 opacity-60` | flex column |
| EffectsTab              | `text-xs`               | `opacity-60` | `py-10`            | flex column |
| MacrosPanel             | `text-[9px]`            | `/30`        | `h-full` centered  | flex        |
| TrackListView           | `text-xs + text-[10px]` | none         | `p-3 text-center`  | plain div   |
| MixerPanel              | `text-xs`               | none         | flex centered      | flex        |

`components/sidebar/EmptyState.tsx` exists (338 bytes) but is barely used. All six patterns should use it.

---

### 18. Text size drift — no enforcement of the type scale

The design system implies a scale but the code mixes magic numbers:

- `text-[8px]` — badge text (InstrumentCard)
- `text-[9px]` — tiny labels, counts, metadata
- `text-[10px]` — most body text, parameter values, track names
- `text-[11px]` — list item primary labels (EffectItem, NavCard)
- `text-[12px]` — InstrumentCard instrument name
- `text-xs` (14px) — preference labels, message text

Items serving identical semantic roles use different sizes (e.g., `EffectItem` names at `text-[11px]`, modulator items at `text-[11px]`, but some track names at `text-[10px]`). No semantic text tokens (`text-daw-label`, `text-daw-body`) are defined in `main.css`. Every size is a one-off magic number.

---

### 19. Section header pattern repeated 8+ times without using `SectionHeader` component

The pattern `text-[9px] font-semibold text-muted-foreground uppercase tracking-wider + icon + flex items-center gap-1` appears inline in:

- `EffectsTab.tsx` search results (4 instances): lines 128-133, 144-149, 169-174, 192-197
- `InstrumentsTab.tsx` group headers (multiple instances)

`components/sidebar/SectionHeader.tsx` exists (448 bytes) but is not used at these sites.

---

### 20. Clip color picker lives as an inline array literal; track color is a proper constant

**Files:** `ClipContextMenu.tsx:408-428` vs `TrackContextMenu.tsx:263-281`

- Clip colors: 8 OKLCH literals defined inline in JSX, not reusable
- Track colors: `TRACK_COLOR_PRESETS` from `helpers/UI/colorPresets.ts`

Fix: extract clip colors to `colorPresets.ts`.

---

### 21. Context menu background/border tokens inconsistent across menus

- ClipContextMenu: `bg-popover border-border`
- TrackContextMenu: `bg-popover border-border` ✓
- ArrangementBar: `bg-popover border-border` ✓
- **ExpandedChannelStrip: `bg-surface-overlay border-border-soft border-t-[var(--color-light-edge)]`** ← differs

ExpandedChannelStrip's context menu uses raw design tokens instead of the Shadcn aliases, giving it a slightly different background (`#151515` vs `#111111` surface-overlay vs popover). All context menus should share the same token set.

---

### 22. Mixer snapshot rename uses raw `<input>` instead of Shadcn `<Input>`

**File:** `MixerPanel.tsx:139-153`

Inline rename input uses hand-styled raw `<input>` (`bg-surface-base border border-ring outline-none`). All other rename inputs use either `<Input>` or a consistent inline pattern. This one has different padding, no ring offset.

---

### 23. `PreferencesDialog` MIDI and Performance sections use raw `<select>` elements

**File:** `PreferencesDialog.tsx:343-401`

Buffer size, sample rate, and MIDI channel selectors use manually-styled raw `<select>` elements. The DAW's dark theme may not override native `<select>` styles correctly at the OS level (especially on macOS). Shadcn `<Select>` uses a Radix portal and fully custom rendering. Fix: replace raw `<select>` with the Shadcn component.

---

### 24. `ArrangementBar` section labels hardcoded as `text-white/90`

**File:** `ArrangementBar.tsx:356`

```tsx
<span className="text-[10px] text-white/90 font-medium px-1.5 truncate">
```

The design system uses `text-foreground` or `--color-text-primary`. Hardcoded `text-white` won't adapt to any light mode or high-contrast mode.

---

### 25. Ableton Link LED is redundant next to a LatchButton with active state

**File:** `TransportControls.tsx:163-178`

The `LatchButton` for Ableton Link and the `LED` next to it both use `variant="amber"` and both reflect the same boolean (`linkEnabled`). When enabled, both glow amber simultaneously — the LED carries no additional information. Compare to the Record button, where the LED reflects _audio capture_ happening (which can differ from the record button's armed state). Fix: either remove the Link LED, or use it to show "peers connected" status vs the button showing "link enabled."

---

## P3 — Minor Cleanup / Polish

### 26. `ArrangeView` has redundant `useEffect` syncing store → local width state

**File:** `ArrangeView.tsx:42-44`

`localTrackListWidth` + `trackListWidthRef` pattern is correct for smooth drag, but the `useEffect` that syncs `trackListWidth` from the store could cause jitter if the store updates mid-drag from an external source.

---

### 27. `EmptyArrangeOverlay` is a 140-line co-located component in ArrangeView

**File:** `ArrangeView.tsx:112-259`

The overlay handles DnD file import, template loading, and track creation with its own `useState`. It should be extracted to its own file; `handleDrop` logic belongs in a use case.

---

### 28. `TrackContextMenu` uses hardcoded `tempo = 120` for audio import

**File:** `TrackContextMenu.tsx:99`

```ts
const tempo = 120;
```

`ArrangeView`'s drop handler correctly reads `transportStore.value?.tempo`. This context menu path always calculates clip duration at 120 BPM regardless of project tempo.

---

### 29. `MacrosPanel` empty state uses `text-muted-foreground/30` — effectively invisible

**File:** `MacrosPanel.tsx:105-107`

`/30` opacity on `muted-foreground` (`#a3a3a3`) produces ~`rgba(163,163,163,0.30)` — almost invisible on dark backgrounds. Every other empty state uses `/50`–`/70`.

---

### 30. `EffectsTab` search result count has no visual distinction from section headers

**File:** `EffectsTab.tsx:116-118`

`text-[9px] font-medium text-muted-foreground/70 uppercase tracking-widest` is the same treatment as section group labels. The count feedback should be differentiated (no uppercase, lighter weight) so it reads as informational, not a category.

---

### 31. `ArrangementBar` uses hardcoded `4000px` cutoff for virtual rendering

**File:** `ArrangementBar.tsx:302`

```ts
if (left + width < 0 || left > 4000) {
    return null;
}
```

`4000` is not shared with `TimelineSurface` or `BeatRulerBar`. Should be a dyanmic value based on available width.

---

### 32. `EffectsTab` route dispatch is a waterfall of `if` statements

**File:** `EffectsTab.tsx` (entire component body)

A sequence of `if (currentRoute.id === '...')` returns with no shared route map. Adding a new route requires inserting another block in the correct order. A `ROUTE_VIEWS` lookup map or a `switch` statement would be cleaner and easier to extend.

---

### 33. `ExpandedChannelStrip` has an empty `className` on two `LatchButton` elements

**File:** `ExpandedChannelStrip.tsx:188, 207`

```tsx
<LatchButton className="" ...>
```

Arm and Monitor buttons both pass `className=""` — a no-op prop that should simply be omitted.

---

_Batch 1 total: 33 issues | P0: 5 | P1: 11 | P2: 9 | P3: 8_

---

## Batch 2 — Continued Audit (AutomationBottomPanel, Inspector, PianoRoll, SessionView, RoutingGraph, PromptBar)

---

## P0 — Bugs / Broken Features

### 34. `SessionView` uses `Object.values(track.clips)` — clips is an array, not a map

**File:** `SessionView.tsx:51`

```ts
const clipArray = Object.values(track.clips) as Array<{ id: string }>;
```

In every other part of the codebase, `track.clips` is a `Clip[]` array (see `Track` model). `Object.values()` on an array returns a copy of the same array, which works accidentally, but the `as Array<{ id: string }>` cast silently strips all clip fields. If `track.clips` is ever typed correctly upstream as an array, `clipArray[sceneIndex]?.id` will still work — but the `Object.values()` call signals a misunderstanding of the data model. More critically, SessionView uses purely local `useState` for slot activation and never actually triggers clip playback on the audio engine. The "Session" view is entirely disconnected from the transport — clicking a slot changes UI state only. This is a fully non-functional feature.

---

### 35. `AutomationBottomPanel` automation mode picker uses a `div` backdrop click-outside instead of `useContextMenuDismiss`

**File:** `AutomationBottomPanel.tsx:209-212`

```tsx
<div className="fixed inset-0 z-40" onClick={() => setShowModePicker(false)} />
```

This "invisible full-screen div" pattern for dismissal blocks all pointer events on the entire app while the picker is open. Clicks on other panels appear not to register — the user experiences a phantom freeze until the picker closes. The same pattern is used for the parameter picker (line 288). Fix: use the `useContextMenuDismiss` hook, which attaches a non-blocking `mousedown` listener.

---

## P1 — Significant Structural Debt

### 36. Hand-rolled click-outside `useEffect` appears **10 times** — the shared hook exists but is not used

**Files:** (from `grep document.addEventListener('mousedown'`)

| File                         | Line |
| ---------------------------- | ---- |
| `useTempoEditorState.ts`     | 88   |
| `ExpandedChannelStrip.tsx`   | 70   |
| `WaveformEditor.tsx`         | 291  |
| `PianoRollContextMenu.tsx`   | 64   |
| `LlmStatusBadge.tsx`         | 31   |
| `TrackAutomationSection.tsx` | 36   |
| `TrackDevicesSection.tsx`    | 42   |
| `RecentProjectsMenu.tsx`     | 80   |
| `ArrangementSelector.tsx`    | 49   |
| `TrackListView.tsx`          | 287  |

In addition to the original 4 flagged in issue #10, there are **6 more** across the inspector and project views. `useContextMenuDismiss` already solves this correctly. This is the single most pervasive structural anti-pattern in the UI layer — 10 unique hand-rolled implementations of the same 8-line hook.

---

### 37. `useContainerWidth` defined inline in `AutomationBottomPanel` — should be a shared hook

**File:** `AutomationBottomPanel.tsx:29-46`

```ts
function useContainerWidth(ref: RefObject<HTMLDivElement | null>): number { ... }
```

A `ResizeObserver`-based container width hook is defined as a module-level function inside `AutomationBottomPanel`. The same pattern (inline `ResizeObserver` in `useEffect`) is independently implemented in `AnalysisPanel.tsx`, `PianoRoll.tsx`, `WaveformEditor.tsx`, `TimelineSurface.tsx`, and `TimelineMinimap.tsx` (5 other places). Fix: extract `useContainerWidth` to `src/helpers/hooks/useContainerWidth.ts` and import it everywhere.

---

### 38. `TrackDevicesSection` and `TrackAutomationSection` each independently re-implement the same add-with-popover UI

**Files:** `Inspector/TrackDevicesSection.tsx`, `Inspector/TrackAutomationSection.tsx`

Both components have:

- `const [showMenu, setShowMenu] = useState(false)`
- A `ref` for the menu container
- The identical `useEffect` click-outside pattern (the hand-rolled one)
- A `<Button>` with `<Plus>` icon that toggles the menu
- A `<div>` absolutely positioned popover with `role="menu"` and item buttons

The JSX structure differs only in the menu items. The "add device" and "add automation lane" menus both have the same chrome. Fix: create a `<InspectorAddMenu>` or use Shadcn `<DropdownMenu>` for both.

---

### 39. `PianoRoll` subscribes to the entire `midiStore` — re-renders on every note change in every clip

**File:** `PianoRoll.tsx:78-87`

```ts
const midiState = useSyncExternalStore(
    (cb) => midiStore.subscribe(() => cb()),
    () => midiStore.value,
    ...
);
const notes = midiState?.notesByClipId[clipId] ?? [];
```

The `midiStore` subscription has no selector — any note change in any clip triggers a re-render of all PianoRoll instances. The same pattern exists for `trackStore` (subscribed in full, only uses `tracks` to find ghost notes). In a project with 16 MIDI tracks all playing simultaneously, every note-on event causes all piano rolls to re-render. Fix: expose a `useMidiNotesByClip(clipId)` selector hook that only notifies when `notesByClipId[clipId]` changes reference.

---

### 40. `ClipInspector` uses a raw `<select>` for Follow Action in an otherwise Shadcn inspector

**File:** `Inspector/ClipInspector.tsx:262-292`

```tsx
<select
    className="rounded bg-surface-overlay text-[10px] text-foreground ..."
    ...
>
```

The rest of `ClipInspector` uses `<Slider>`, `<Input>`, `<Button>`, `<Separator>` — all Shadcn. The Follow Action dropdown is the only raw `<select>` in the inspector. It also uses `as any` for the value type cast (line 267), which should be a proper union type. Fix: replace with `<Select>` from Shadcn and add a proper `FollowAction` union type.

---

### 41. `TrackHeaderSection` — `aria-label="Set color"` is non-descriptive on all color swatches

**File:** `Inspector/TrackHeaderSection.tsx:108`

```tsx
aria-label={`Set color`}
```

All 16 color swatch buttons have the identical aria-label `"Set color"`. A screen reader user cannot distinguish between them. Fix: `aria-label={`Set track color to ${c}`}` — the label already exists for clip swatches in `ClipInspector.tsx:237` where it uses the color value as the label, but TrackHeaderSection doesn't. Additionally `ClipInspector` uses `c || 'Default color'` which is slightly better.

---

### 42. `AutomationBottomPanel` subscribes to 4 stores at the top level — causes over-rendering

**File:** `AutomationBottomPanel.tsx:96-118`

```ts
const trackState = useSyncExternalStore(...trackStore...);
const autoState  = useSyncExternalStore(...automationStore...);
const viewState  = useSyncExternalStore(...timelineViewStore...);
const ws         = useSyncExternalStore(...workspaceStore...);
```

All four subscriptions are broad — no selectors. The component re-renders whenever any track is updated, any automation point is moved, the timeline scroll position changes, or any workspace state changes. During playback with automation moving points, this is every animation frame. The component only needs:

- `selectedTrackId` + selected track data from `trackStore`
- `lanes` for the selected track from `automationStore`
- `pixelsPerBeat` + `scrollX` from `timelineViewStore`
- `trackListWidth` + `trackListOpen` from `workspaceStore`

Fix: create selector-scoped subscription hooks for each dependency.

---

## P2 — Design System / Inconsistencies

### 43. `PromptBar` dropdown uses `border-border-soft border-t-[var(--color-light-edge)]` — same off-token pattern as `ExpandedChannelStrip`

**File:** `PromptBar.tsx:219`

```tsx
className = '... border border-border-soft border-t-[var(--color-light-edge)] bg-surface-overlay ...';
```

Like the `ExpandedChannelStrip` context menu, the PromptBar suggestion dropdown uses raw design tokens instead of the Shadcn `bg-popover border-border` convention used by all other dropdowns. This creates a third distinct surface treatment for what is functionally a popover. Fix: use `bg-popover border-border` to match.

---

### 44. Inspector section headers use a different pattern than sidebar section headers

**Files:** `Inspector/TrackDevicesSection.tsx:51`, `Inspector/TrackAutomationSection.tsx:45`

```tsx
<div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Devices</div>
```

The Inspector uses `text-[10px] font-medium` for section labels. The sidebar uses `text-[9px] font-semibold`. Both are uppercase + tracking-wider, but different sizes and weights — visually distinct for what is the same semantic role (a collapsible section label). The sidebar's `SectionHeader` component is not used in the Inspector at all. Fix: decide on one canonical section header style and apply it to both contexts.

---

### 45. `RoutingGraph` calls `resolveToken()` on every render for every color — no memoization

**File:** `RoutingGraph.tsx:19-25`

```ts
const KIND_FILLS: Record<string, string> = {
    audio: resolveToken('--color-palette-steel', '#4a7090'),
    midi:  resolveToken('--color-accent-lavender', '#a89bc4'),
    ...
};
```

`KIND_FILLS` is defined at module level (outside the component), which is fine — but `TrackNode` and `ConnectionLine` call `resolveToken(...)` inline on every render (lines 70, 95, 124, 299-312). `resolveToken` reads `getComputedStyle(document.documentElement)` which forces a style recalculation. With 10+ tracks each triggering `resolveToken` calls on every store update, this adds up. Fix: compute fill colors once outside the component, or use hardcoded fallback values that match the design system constants (which are already known at compile time).

---

### 46. `AutomationLaneRow` has inline SVG grid colors as raw RGBA strings

**File:** `AutomationLaneRow.tsx:331-352`

```tsx
stroke="rgba(255,255,255,0.04)"   // horizontal grid
stroke={beat % 4 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'}  // beat grid
```

Both the horizontal grid lines and beat grid lines use raw RGBA rgba strings in SVG `stroke` attributes. These should reference `--color-meter-grid` (`rgba(255,255,255,0.08)`) which is already defined in the design system for meter displays. A bar-line / beat-hairline variant should also be tokenized.

---

### 47. `FuzzyResultItem` in `PromptBar` uses template literal for conditional className construction

**File:** `PromptBar.tsx:93-97`

```tsx
className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors ${
    isSelected
        ? 'bg-white/[0.08] text-foreground'
        : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'
}`}
```

The selected state uses `bg-white/[0.08]` (a raw opacity hack) while the hover state uses `hover:bg-white/[0.06]`. The design system has `bg-accent/50` for hover states on popover items — this is what the `TrackDevicesSection` and `TrackAutomationSection` device menus use. Three different approaches to the same interaction state in the same codebase. Fix: use `cn()` with `bg-accent` tokens consistently.

---

## P3 — Minor Cleanup / Polish

### 48. `AutomationLaneRow` is 609 lines — the longest view file in the codebase

**File:** `AutomationLaneRow.tsx`

The component handles: SVG path building, drag interactions, rubber-band selection, tension handles, automation objects, playhead interpolation, Y-axis zoom, keyboard shortcut handling, and context menu state. The file is split into sub-components (`AutomationLaneHeader`, `AutomationLaneControls`, `AutomationContextMenu`) but the main component body is still 609 lines. The path-building logic (lines 127-163) and the SVG interaction dispatcher (lines 169-250) are legitimate candidates for extraction into helpers.

---

### 49. `RoutingGraph` truncates track names to 12 characters with a hardcoded slice

**File:** `RoutingGraph.tsx:105`

```ts
{
    pos.track.name.length > 12 ? `${pos.track.name.slice(0, 11)}…` : pos.track.name;
}
```

This is a layout limitation (nodes are fixed width `NODE_W = 100`). But the truncation happens in JSX instead of using CSS `truncate`. An SVG `<text>` element with `textLength` or a CSS `text-overflow: ellipsis` approach would be cleaner and more robust for different font metrics.

---

### 50. `TrackHeaderSection` notes textarea uses raw `<textarea>` with manually written focus ring

**File:** `Inspector/TrackHeaderSection.tsx:117-128`

```tsx
<textarea
    className="... focus:ring-1 focus:ring-border-focus resize-y min-h-[60px]"
```

The rest of the inspector uses Shadcn form components. The notes textarea is the only unabstracted form element in the inspector. It manually recreates `focus:ring-1 focus:ring-border-focus` which is what the Shadcn `<Textarea>` component already provides. Fix: replace with the Shadcn `<Textarea>` component.

---

_Total batch 2 issues: 17_  
_New P0: 2 | New P1: 7 | New P2: 5 | New P3: 3_

---

---

## Batch 3 — Architecture, Use Cases, Repositories, Barrel Files (Full Module Sweep)

> Scope: all 18 modules audited for DDD boundary violations, barrel re-export anti-patterns, one-function-per-file rule, private internals leaking cross-module, and repository vs. use-case layer confusion.

---

## P0 — Architecture Violations (Contract Boundary Breaches)

### 51. `Toaster` module imports directly from `Arrangement/repositories/track` (private internal)

**Files:**

- `src/modules/Toaster/useCases/createDrumTrackStack.ts:14` — `import { getTrackState, setTrackState } from '#/modules/Arrangement/repositories/track'`
- `src/modules/Toaster/useCases/toasterParamBridge.ts:8` — `import { getAllTracks } from '#/modules/Arrangement/repositories/track/queries'`
- `src/modules/Toaster/useCases/triggerPad.ts:7` — same
- `src/modules/Toaster/useCases/loadToasterKit.ts:8` — same
- `src/modules/Toaster/useCases/exportPatternToTimeline.ts:6` — same

And `src/modules/Fermenter/useCases/fermenterParamBridge.ts:10` — `getAllTracks` from same private repo.

The `repositories/track` module is architecturally private to `Arrangement`. Cross-module consumers **must** use `Arrangement/useCases/trackQueries` (the public contract). These imports break the DDD boundary and expose the raw repository layer to unrelated modules. `trackQueries` already exports all of these functions.

**Fix:** Replace all 6 import sites with `import { ... } from '#/modules/Arrangement/useCases/trackQueries'`.

---

### 52. `Toaster/useCases/createDrumTrackStack` imports from `Arrangement/models/Track` (private model)

**File:** `src/modules/Toaster/useCases/createDrumTrackStack.ts:13`

```ts
import { createTrack } from '#/modules/Arrangement/models/Track';
```

Per the architecture, models are **strictly private** to their module. `createTrack` is already re-exported from `Arrangement/useCases/trackQueries`. Fix: use the trackQueries path.

---

### 53. `Fermenter/repositories/fermenterPresets.ts` imports from `Arrangement/models/SoundPreset` (private model)

**File:** `src/modules/Fermenter/repositories/fermenterPresets.ts:6`

```ts
import { type SoundPreset, type DevicePreset } from '#/modules/Arrangement/models/SoundPreset';
```

`SoundPreset` is Arrangement-private. It needs to be exported from the Arrangement module's use-case contract (e.g. `useCases/soundPresetLibrary.ts` already exists). Fix: export from Arrangement's use-case layer and update the Fermenter import.

---

### 54. `MIDI/useCases/patternInstance.ts` and `importMidiFile.ts` import `Arrangement/models/Track` directly

**Files:**

- `MIDI/useCases/patternInstance.ts:10` — `import { type Clip } from '#/modules/Arrangement/models/Track'`
- `MIDI/useCases/importMidiFile.ts:4` — `import { createTrack } from '#/modules/Arrangement/models/Track'`

Both `Clip` type and `createTrack` are available in `trackQueries`. MIDI should not know about Arrangement's model internals. Fix: import from `trackQueries`.

---

### 55. `Workspace/presentations` components import `Arrangement/models` directly (8 files)

The rule is: cross-module imports must come from use-case contract folders, not models. The following presentation files break this by importing types directly from Arrangement's private model layer:

| File                                             | Import                                                     |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `Inspector/ClipInspector.tsx:14`                 | `type Clip` from `Arrangement/models/Track`                |
| `Inspector/TrackDevicesSection.tsx:13`           | `type Track` from `Arrangement/models/Track`               |
| `Inspector/TrackAlternativesSection.tsx:11`      | `type Track` from `Arrangement/models/Track`               |
| `Inspector/DeviceInspector.tsx:4,7`              | `BUILTIN_PLUGINS`, `type Device` from models               |
| `Inspector/deviceLayoutRegistry.tsx:15,16`       | `type DeviceParameter`, `type Device` from models          |
| `Inspector/ClipAudioAiSection.tsx:6`             | `type Clip` from `Arrangement/models/Track`                |
| `Inspector/TrackRoutingSection.tsx:4` + 9 others | `type Track` from models                                   |
| `Sidebar/InstrumentsTab.tsx:6`                   | `type SoundPreset`, `type SoundPresetCategory` from models |
| `Sidebar/effectsTabHelpers.tsx:24`               | `type BUILTIN_PLUGINS` from models                         |
| `Sidebar/EffectsTab.tsx:3,4`                     | `type BUILTIN_PLUGINS`, `type SoundPreset` from models     |

All these types are either already exported through `Arrangement/useCases/trackQueries` or should be added there. This is the most widespread architecture violation in the presentation layer: **15+ files bypassing the use-case contract** of the Arrangement module.

---

### 56. `AiGeneration/useCases/llmMidiGeneration.ts` imports from `AudioEngine/repositories/nativeAIBridge` (private repo)

**File:** `src/modules/AiGeneration/useCases/llmMidiGeneration.ts:13`

```ts
import { type GeneratedNote } from '#/modules/AudioEngine/repositories/nativeAIBridge';
```

Repositories are private to their module. `GeneratedNote` is an internal data shape that belongs in a use-case or model. Fix: move `GeneratedNote` to `AudioEngine/useCases/` (as a use-case-level DTO) or `AudioEngine/models/` and re-export it through a use-case.

---

### 57. `AudioEngine/engine/TrackNode.ts` imports from `Arrangement/useCases/trackQueries` — engine layer breach

**File:** `src/modules/AudioEngine/engine/TrackNode.ts:13`

```ts
import { isDeviceSupportedOnCurrentPlatform } from '#/modules/Arrangement/useCases/trackQueries';
```

The `engine/` layer is supposed to be the real-time audio graph — it should only receive data injected by use cases. Importing a use-case query directly from the engine creates a tight coupling between the RT audio graph and the Arrangement domain. Additionally, `AudioEngine/repositories/webMidi/messageHandlers.ts` imports multiple types from `trackQueries` — repositories should obtain data from the engine layer, not by reaching up into Arrangement use-cases.

**Fix:** Inject `isDeviceSupportedOnCurrentPlatform` as a dependency into `TrackNode` via the use-case that creates it.

---

### 58. `Workspace/presentations/views/Inspector/TrackDevicesSection.tsx` imports from `Arrangement/repositories/getPlatformPlugins` directly

**File:** `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx:5`

```ts
import { getPlatformPlugins } from '#/modules/Arrangement/repositories/getPlatformPlugins';
```

`getPlatformPlugins` is a repository. Presentation views must not import from repositories — they must use use-cases. `getPlatformPlugins` is already correctly re-exported from `Arrangement/useCases/trackQueries`. This file simply uses the wrong import path.

---

### 59. `Plugin/useCases` internals accessed directly from `Workspace/presentations/views`

**Files:**

- `Sidebar/EffectsTab.tsx:9` — `MIDI_EFFECT_FACTORIES` from `Plugin/useCases/midiEffectPlugins/registry`
- `Mixer/DeviceChainSection.tsx:11` — `getAllModulationRoutes` from `Plugin/useCases/modulationSystem/getAllModulationRoutes`
- `Mixer/DeviceChainSection.tsx:12` — `MIDI_EFFECT_FACTORIES` from `Plugin/useCases/midiEffectPlugins/registry`

`midiEffectPlugins/registry` and `modulationSystem/getAllModulationRoutes` are internal Plugin use-case files. They are consumed directly by views in the Workspace module. Per the architecture, cross-module imports must come from the module's own use-case public API — not deeply-nested internal files. These need a `Plugin/useCases/pluginQueries.ts` (or similar) that re-exports `MIDI_EFFECT_FACTORIES` and `getAllModulationRoutes` as the official surface.

---

## P1 — Significant Structural Debt (Module Layer)

### 60. `trackQueries/index.ts` is a pseudo-barrel that aggregates cross-module state accessors and private model re-exports — the comment on the file even calls them "boundary violations"

**File:** `src/modules/Arrangement/useCases/trackQueries/index.ts`

The file itself contains the comment:

```ts
// ── Cross-module accessors (boundary violations — see individual files) ──
export { getMidiStoreState, setMidiStoreState, getMidiLearnState } from './midiStoreAccess';
export { getAutomationLanes, getAutomationStoreState } from './automationStoreAccess';
```

The file is a recognized compromise: it acknowledges known boundary violations but leaves them marked and unresolved. Additionally it re-exports `BUILTIN_PLUGINS`, `createTrack`, `createMidiNote`, `getPlatformPlugins` — none of which are query use cases; they are model factories and repository helpers. These don't belong in a query use-case file.

**Fix:** Split `trackQueries` into:

1. `trackQueries/index.ts` — genuine read-only queries only
2. A `trackContracts.ts` file (or promote types into each specific use-case per the DTO pattern) for the model re-exports
3. Move `BUILTIN_PLUGINS`, `createTrack` etc. to the Arrangement module's dedicated contract exports

---

### 61. `MIDI/useCases/midi.ts` is a mega-barrel that re-exports the entire MIDI use-case surface — the file's first line warns "import from the specific file when possible"

**File:** `src/modules/MIDI/useCases/midi.ts`

```ts
/**
 * Barrel re-export — all MIDI use cases split into focused files.
 * Import from the specific file when possible.
 */
```

48 consumers import through this barrel (confirmed by grep). The barrel re-exports use cases from `midiNoteCrud`, `midiNoteTransforms`, `midiEvent`, models from `MidiNote` — mixing different semantic domains in one import surface. Per the architecture rules, "NO BARREL FILES" and modules should expose contracts through individual use-case files.

None of the 48 consumers are required to use the barrel — they could import from the specific use-case subdirectory files (e.g. `#/modules/MIDI/useCases/midiNoteCrud/addMidiNote`).

---

### 62. The `timelineViewActions.ts` is a pseudo-barrel of 35 wrapper functions that all forward 1:1 to real use-cases — pure boilerplate layer with no logic

**File:** `src/modules/Arrangement/useCases/timelineViewActions.ts`

```ts
export const splitClip: typeof _splitClip = (...args) => _splitClip(...args);
export const normalizeClip: typeof _normalizeClip = (...args) => _normalizeClip(...args);
// ... 33 more identical wrappers
```

Every function is `export const foo: typeof _foo = (...args) => _foo(...args)`. This adds 109 lines, a whole file, and a full indirection layer with zero business logic. The stated reason (presentation files shouldn't import from other modules) is correct — but the solution should be direct re-exports (`export { splitClip } from './clipEditing/splitClip'`), not forwarding functions. The function wrappers prevent tree-shaking, add stack frames, and confuse call stacks during debugging.

---

### 63. `clipHandlers.ts` and `trackHandlers.ts` each export a **single object** containing 20+ action handlers — violates one-function-per-file rule for use-case files

**Files:** `clipHandlers.ts` (424 lines), `trackHandlers.ts` (420 lines)

Each exports a single object (`clipHandlers`, `trackHandlers`) with ~20 properties where each property is an `{ execute, describe, undoable }` action handler. This violates the "One Function Per File" AGENTS.md rule for use-case files, and means every consumer (just `executeAppAction.ts`) loads the entire 424-line file even when it only needs one handler.

The architecture already has individual use-case files for all the underlying operations — `clipEditing/splitClip.ts`, `clipEditing/setClipColor.ts`, etc. The handler objects are just dispatch tables mapping action types to those use cases.

**Fix:** Either collapse handler registration into `executeAppAction.ts` directly, or make each `ActionHandler` its own file following the one-function rule.

---

### 64. `Arrangement/useCases/contracts.ts` is a pseudo-barrel that violates "NO BARREL FILES"

**File:** `src/modules/Arrangement/useCases/contracts.ts`

```ts
export type { Track, Clip, Device, ... } from '../models/Track';
export type { DeviceParameter, DeviceParameterType } from '../models/DeviceParameter';
export { BUILTIN_PLUGINS, isDeviceSupportedOnCurrentPlatform, getPluginById } from '../models/DeviceParameter';
```

The AGENTS.md explicitly says: **"Do not create pseudo-barrel files like `contracts.ts`"**. This file does exactly that. It currently has zero consumers (grep confirmed), meaning it's dead code on top of being a forbidden pattern.

---

### 65. `sidechain.ts` in `Routing/useCases` manages its own in-memory state (`let sidechainState = { routes: [] }`) — this is a store, not a use case

**File:** `src/modules/Routing/useCases/sidechain.ts`

The file maintains mutable module-level state (`let sidechainState`), exports query functions over it (`getAllSidechainRoutes`), and mutation functions (`addSidechainRoute`, `setSidechainRoutes`). This is a store masquerading as a use-case file. Per the architecture, state should live in `stores/`, not as module-scope variables in use-case files.

---

### 66. `Arrangement/useCases/trackHandlers.ts` reaches into `Routing/useCases/sidechain` — cross-domain business logic in a handler

**File:** `src/modules/Arrangement/useCases/deviceHandlers.ts:16`

```ts
import { ... } from '#/modules/Routing/useCases/sidechain';
```

`deviceHandlers.ts` imports sidechain use-cases. The handler file is already a cross-cutting concern; adding routing logic to it couples Arrangement ↔ Routing at the handler level, which should be the most isolated layer.

---

### 67. `AiRuntime/models/presetActions/presets/index.ts` is a barrel inside models — violates "NO BARREL FILES" rule

**File:** `src/modules/AiRuntime/models/presetActions/presets/index.ts`

Aggregates 9 category-specific preset files into one export. While this is internal-to-module and not cross-module, the project explicitly prohibits barrel files, including internal ones. The barrel is used by `registry.ts` which is directly above it — that single consumer should import from each file directly.

---

### 68. `AudioEngine/repositories/devices/index.ts` — repository sub-barrel re-exporting 6 device sub-files

**File:** `src/modules/AudioEngine/repositories/devices/index.ts`

Groups `dynamics.ts`, `reverbDelay.ts`, `toneShaping.ts`, `modulation.ts`, `types.ts` all into one re-export barrel. The only consumer is `deviceNodeFactory.ts`. That file would be cleaner importing from each sub-file directly. While not a cross-module issue, it's still a barrel file the architecture explicitly bans.

The same pattern exists in:

- `AudioEngine/repositories/audioDecoding/index.ts`
- `AudioEngine/repositories/audioEncoders/index.ts`
- `AudioEngine/repositories/webMidi/index.ts`
- `AudioEngine/repositories/offlineScheduler/index.ts`
- `AudioEngine/repositories/nativeAIBridge/index.ts`

That's **6 barrel files in AudioEngine/repositories alone**, all of them internal re-export barrels.

---

### 69. `AiRuntime` has 4 barrel files in repositories, 2 in use cases, 1 in models, 1 in transformers — totaling 8 index.ts barrel files in a single module

Audit of `AiRuntime` `index.ts` files:

- `repositories/cloudLlm/index.ts` — barrel
- `repositories/webLlm/index.ts` — barrel
- `repositories/nativeEngine/index.ts` — barrel
- `repositories/mixAnalysis/index.ts` — barrel
- `useCases/llmOrchestration/index.ts` — barrel
- `useCases/musicMentor/index.ts` — barrel
- `models/presetActions/index.ts` — barrel
- `models/presetActions/presets/index.ts` — barrel
- `transformers/promptParser/index.ts` — barrel
- `models/tools/index.ts` — barrel

That's **10 barrel files** in one module, all violating the architecture rule. The `AiRuntime` module is the single heaviest adopter of the banned barrel pattern.

---

### 70. `Transport/useCases/transportControls/index.ts` exports 18 functions from a single barrel — each should be directly imported from its file

**File:** `src/modules/Transport/useCases/transportControls/index.ts`

Aggregates `togglePlayback`, `pausePlayback`, `startPlayback`, `stopPlayback`, `toggleLoop`, etc. — 18 functions. The `TransportControls` useCase directory already has individual files. Consumers should import directly from `togglePlayback.ts`, not via the barrel.

Similar pattern in:

- `Transport/useCases/punchRecording/index.ts` (10 exports)
- `Transport/useCases/setlist/index.ts`
- `Transport/useCases/tempoMapping/index.ts`
- `Arrangement/useCases/vca/index.ts`
- `Arrangement/useCases/freezeBounce/index.ts`
- `SoundLibrary/useCases/sampleDatabase/index.ts`

Total: **7 more Transport/Arrangement use-case barrels**.

---

### 71. `Fermenter/presentations/components` imports from `Workspace/presentations/components` — cross-module private component access

**Files:**

- `Fermenter/presentations/components/FilterSection.tsx:8` — `import { FilterResponse } from '#/modules/Workspace/presentations/components/FilterResponse'`
- `Fermenter/presentations/components/EffectsSection.tsx:8-11` — imports `EQCurve`, `CompressorCurve`, `DelayTaps`, `DistortionCurve` from `Workspace/presentations/components/`
- `Fermenter/presentations/components/EnvelopeSection.tsx:7` — `ADSREnvelope`
- `Fermenter/presentations/components/OscillatorSection.tsx:7` — `OscillatorWaveform`

Per the architecture, `presentations/components/` is **strictly private** to its module. Fermenter is a separate module that must not reach into Workspace's private components. These 6 shared visualization components (`FilterResponse`, `EQCurve`, `CompressorCurve`, `DelayTaps`, `DistortionCurve`, `ADSREnvelope`, `OscillatorWaveform`) are used across module boundaries, meaning they belong in a **shared** location — either a top-level `src/components/daw/` shared directory or promoted to each module's `presentations/views/` (which _can_ be imported cross-module per the architecture: "presentations/views" is a contract folder).

---

### 72. `Workspace/presentations/views/AutomationView` imports from `Automation/useCases/automation/types` — bypassing the Automation module's contract

**Files:**

- `AutomationView/AutomationLaneRow.tsx:14`
- `AutomationView/TrackAutomationSection.tsx:10`
- `AutomationView/AutomationContextMenu.tsx:7`

```ts
import { type AutomationLane, type AutomationCurveType } from '#/modules/Automation/useCases/automation/types';
```

`types.ts` is inside the `automation/` use-case subfolder — it's an internal types file, not a module-level contract. The Automation module should export these types through a proper use-case contract (e.g. `Automation/useCases/automationQueries.ts` or similar), and the Workspace views should import from there.

These same types are already correctly exported via `Arrangement/useCases/trackQueries` (which re-exports from Automation). The three AutomationView files should import from `trackQueries` instead of reaching into Automation internals.

---

## P2 — Design / Structural Issues

### 73. `executeAppAction.ts` imports **25 handler modules** at the top level — cold start cost

**File:** `src/modules/Command/useCases/executeAppAction.ts`

25 separate handler imports at the top level of the command dispatch function:

```ts
import { trackHandlers } from '...';
import { clipHandlers } from '...';
import { transportHandlers } from '...';
// ... 22 more
```

Every one of these is loaded eagerly at app startup. Many handlers (e.g. `collaborationHandlers`, `versionControlHandlers`, `aiOrganizationHandlers`) are for features not used on every session. Dynamic `import()` for infrequently-used handler groups would significantly reduce the initial parse/eval budget. Additionally, there's a mid-file `const logger = ...` after some imports (line 7 before `import` on line 8), which is a module initialization order issue.

---

### 74. `Routing` module has no `stores/` — global sidechain state is hidden in a use-case file

**File:** `src/modules/Routing/useCases/sidechain.ts` (see also #65)

The `Routing` module has only a `useCases/` folder with two files (`sidechain.ts`, `busControls.ts`), no `models/`, `stores/`, or `repositories/`. All routing state is implicit module-level variables. This is an incomplete module structure that breaks the project's three-tier state ownership model.

---

### 75. `Project/useCases/demoProjects` barrel and its 4 demo sub-barrels each contain hundreds/thousands of lines of inline data

**Files:** `demoProjects/resonance/index.ts`, `cinematic/index.ts`, `synthwave/index.ts`, `eightyEight/index.ts`

These demo project files are effectively data-generation scripts wrapped in `index.ts` "barrel" files. The resonance demo is ~1,900+ lines of clip/note/automation data defined inline. This kind of data should live in static JSON/TypeScript data files imported by a loader, not coded and executed as procedural imperative code. The barrel naming (`index.ts`) makes them look like re-export aggregators when they are actually the implementation entry points.

---

### 76. `Synth/useCases/drumSynthEngine/index.ts` re-exports from `Synth/engine/` — engine internals exposed via use-case barrel

**File:** `src/modules/Synth/useCases/drumSynthEngine/index.ts`

```ts
export { scheduleDrumVoice } from '#/modules/Synth/engine/drumSynthVoices';
```

The `Synth/engine/` is a private internal, analogous to `AudioEngine/engine/`. Exposing `scheduleDrumVoice` through a use-case barrel is an engine-private-internal leak. The use-case layer should call the engine via injected dependencies, not re-export the engine function directly.

---

## P3 — Minor Cleanup

### 77. `Collaboration/useCases/collaboration/index.ts` re-exports `punchRecordingStore` from a use-case barrel

The `punchRecording/index.ts` barrel:

```ts
export { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';
```

Exporting a store from a use-case barrel conflates state management with use-case orchestration. Consumers can import the store directly from its file.

---

### 78. `MIDI/useCases/chordTrack/index.ts` re-exports from `MIDI/transformers/chordTransposer` with a "backward compat" comment

```ts
// Transformers (re-exported for backward compat, consumers should migrate to Midi/transformers/)
export { transposeNoteToChord, transposeForChordTrack } from '#/modules/MIDI/transformers/chordTransposer';
```

The architectural guidance says "no barrel files" and transformers are private. This backward-compat re-export is a technical debt stub that has no defined migration timeline. Either migrate consumers or document it as a permanent API surface.

---

### 79. `scripts/refactorTrackQueries.js` exists in the repo root — a leftover codemod script

**File:** `scripts/refactorTrackQueries.js` (visible in open editor tabs)

A codemod script committed to the repository root. If it's a one-time refactoring tool, it should be deleted after use. If it's reusable, it should be in a proper `scripts/` directory with documentation. Working files left in the repo are noise.

---

_Batch 3 total: 29 issues_  
_New P0: 9 | New P1: 10 | New P2: 5 | New P3: 3_

---

## Batch 4 — AI, Command, Workspace, and Transport Intersections

> Scope: Audited `AiRuntime`, `AiGeneration`, `Workspace`, `Transport`, `Command`, `Analysis`, and `SoundLibrary`. Focus on store boundary violations, component bloat, UI mixed with state, and cross-module command wiring.

---

## P0 — Architecture Violations (Direct Store Access & Logic Leaking)

### 80. `AiRuntime/useCases/getProjectContext.ts` bypasses all module contracts and reads 4 private stores directly

**File:** `src/modules/AiRuntime/useCases/getProjectContext.ts`

```ts
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
```

`getProjectContext` is a "god function" that reads `trackStore.value`, `transportStore.value`, and `workspaceStore.value` directly to serialize the state for the LLM. Accessing other modules' stores directly destroys module isolation. It should query public contracts (e.g., `getTrackStoreState()`, `getTransportState()`).

---

### 81. `Command` layer functions manipulate and read stores directly instead of invoking Use Cases

**Files:**

- `Command/models/commands/viewCommands.ts` imports `timelineViewStore`, `transportStore`, `playheadPositionRef`
- `Command/models/commands/trackCommands.ts` imports `trackStore`
- `Command/presentations/hooks/useGlobalKeyboardShortcuts.ts` imports `trackStore` and `zoomTimeline`

Commands are supposed to be routing mechanisms that dispatch `AppAction` payloads to handlers, or call a dedicated cross-module use-case. Directly querying or invoking store mutations (like `zoomTimeline()`) inside the command definition tightly couples the command registry to private state implementations.

---

### 82. Business logic and UI functions living inside Store files

**Files:**

- `AiRuntime/stores/aiActionHistoryStore.ts:48` — `export function toggleAiHistoryPanel(): void`
- `AiRuntime/stores/chatStore.ts:65` — `export function clearChatMessages(): void`

Store files must _only_ define the reactive state primitive (the `Store` instance) and its shape. Mutations like clearing chat or toggling UI panels belong in the `useCases/` layer. Placing them in the store file creates a circular dependency risk and mixes state ownership with domain logic.

---

### 83. Porous boundary between `AiRuntime` and `AiGeneration`

**Files:**

- `AiRuntime/presentations/views/GenerativeAiPanel.tsx` imports from `AiGeneration/useCases/actions/taskManagement` and `audioProcessing` directly.

`AiRuntime` manages the LLM. `AiGeneration` executes specific generative tasks. By importing `AiGeneration` use-cases directly into `AiRuntime` views, the boundary is broken. Communication between these domains should happen via structured `AppAction` events, not direct function calls across module boundaries.

---

## P1 — Significant Structural Debt (Module Level)

### 84. `AppAction.ts` is a monolithic 292-line discriminated union of 215 types

**File:** `src/modules/Command/models/AppAction.ts`

The central `AppAction` type union handles 215 different types, from `addTrack` to `setWarpPitchShift`. While the handlers are split, the actual type definition is a massive god-type. Every time an action is routed, TypeScript must resolve a 215-member union. It should be modularized (e.g., `type AppAction = TrackAction | TransportAction | ViewAction ...`).

---

### 85. Extreme UI component bloat masquerading as Views (500+ line files)

Several presentation files contain far too much inline logic, custom rendering loops, and unfiltered store subscriptions.

- `Workspace/presentations/views/ClipView/WaveformEditor.tsx` (483 lines)
- `AiRuntime/presentations/views/GenerativeAiPanel.tsx` (438 lines)
- `Workspace/presentations/views/Mixer/ExpandedChannelStrip.tsx` (410 lines)
- `AiRuntime/presentations/views/PatternBrowser.tsx` (379 lines)

These trace back to a failure to break down complex UI states into composed sub-components and smaller derived state hooks.

---

### 86. `usePianoRollInteractions` is 571 lines of monolithic pointer-event math

**File:** `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts`

Only contains 10 React hooks (`useRef`, `useState`) showing that the bulk of these 571 lines is dense, imperative mathematical logic inside massive event handlers (`onPointerDown`, `onPointerMove`). This logic needs to be extracted out of the React layer and into pure functional DOM/math helpers in `transformers` or `helpers`.

---

### 87. Two newly identified barrel files (`index.ts` re-exports)

- `SoundLibrary/useCases/sampleDatabase/index.ts`
- `AudioAnalysis/useCases/referenceMixComparison/index.ts`

Violates the strictly enforced architecture rule: NO BARREL FILES.

---

## P2 — Non-Reactive Rendering Anti-Patterns

### 88. Direct DOM mutation from React via `playheadPositionRef`

**File:** `src/modules/Workspace/presentations/views/Transport/PlayheadDisplay.tsx`

This file intentionally bypasses React, reading `playheadPositionRef` in a `requestAnimationFrame` loop and writing directly to the `ref.current.textContent`. While optimized to avoid React state reconciliation, having raw DOM mutation baked directly into a functional component circumvents the `useSyncExternalStore` pattern defined in the architecture. It should utilize Canvas/OffscreenCanvas for dense drawing interfaces, rather than text-node string manipulation.

---

_Batch 4 total: 9 issues_  
_New P0: 4 | New P1: 4 | New P2: 1 | New P3: 0_

---

## Batch 5 — Strict Dependency Violations & Dedicated Instrument Suites

> Scope: Analyzed output of `pnpm deps:validate` revealing hard constraint breaches. Audited UI of `Toaster`, `Fermenter`, and `Levain`.

---

## P0 — Hard Architectural Boundary Violations (The 60 Errors)

The codebase's static dependency graph is broken. Running `pnpm deps:validate` flags precisely **60 dependency violations**. They map to the following core architectural rules:

### 89. Rule Violation: `presentations-no-direct-io` (5 occurrences)

Views and presentation components are directly importing Repositories (I/O, presets, API access), bypassing the Use Case layer orchestrator.

- `ToasterPanel.tsx` → `toasterPresets.ts`
- `LevainPresetBrowser.tsx` → `levainPresets.ts`
- `FermenterPanel.tsx`, `TransformPad.tsx`, `PresetBrowser.tsx` → `fermenterPresets.ts`

### 90. Rule Violation: `no-cross-module-internals` (18 occurrences)

Use-cases or components are reaching directly into the private `repositories/` or `models/` folders of foreign modules.

- **AudioEngine bypass**: `Toaster/useCases/triggerPad`, `toasterParamBridge`, `sequencerPlayback`, and `loadToasterKit` directly import `audioEngine` from `AudioEngine/repositories` to circumvent the AudioEngine use-case contract.
- **Arrangement Models bypass**: Device Inspectors (`TrackDevicesSection`, `TrackAutomationSection`) reach into `Arrangement/models/DeviceParameter` instead of using public query accessors.

### 91. Rule Violation: `models-private-cross` (6 occurrences)

Models importing models from other modules directly.

- `Toaster` and `MIDI` use-cases importing `Arrangement/models/Track.ts`.

### 92. Rule Violation: `components-private-cross` (7 occurrences)

Presentation components in one module importing presentation components from a completely different module, inducing tight UI coupling.

- `Fermenter/presentations/components/*` aggressively imports isolated visualizations (`OscillatorWaveform`, `FilterResponse`, `ADSREnvelope`, `EQCurve`) straight out of `Workspace/presentations/components/`.

### 93. Rule Violation: `components-no-usecase-access` (24 occurrences)

"Dumb" React UI components are binding directly to Use Case orchestration logic, turning them non-reusable and side-effect heavy.

- `Toaster/.../SequencerToolbar.tsx` executing `applyEuclidean.ts`
- `Levain/.../LegatoTuning.tsx` executing `levainParamBridge.ts`
- `Fermenter/.../TransformPad.tsx` executing `presetMorph.ts`

---

## P2 — UI/UX Flaws and React Component Bloat

### 94. UI Components Coupled to Business Domain (`TransformPad.tsx`, `SequencerToolbar.tsx`)

Because these components manually import use cases (like `applyMorphedPatch`), they cannot be tested in isolation or rendered without fulfilling the exact module ecosystem requirements. They should accept `onMorphChange` or `onApplyEuclidean` functions as standard React `props`, allowing the higher-order View to handle state orchestration.

### 95. Visual Ecosystem Rejection

Instrument sub-components manually render standard HTML tags (`<input type="number">` and `<select>`) and hardcode inline borders (`border-border/40`) instead of utilizing the global Shadcn UI libraries or `@theme` tokens. This creates an unpolished UI rift where built-in instruments (Toaster/Fermenter) look functionally and stylistically detached from the core workspace interface.

---

_Batch 5 total: 7 discrete issues representing 60 files_  
_New P0: 5 | New P1: 0 | New P2: 2 | New P3: 0_

---

## Batch 6 — The Core Engine Bleed and Remaining Modules

> Scope: Audited the internal depths of `AudioEngine`, `Plugin`, `Synth`, `Extension`, and `Routing`.

---

## P0 — Hard Architectural Boundary Violations

### 96. Inversion of Control in the Audio Thread (`TrackNode.ts`)

The `AudioEngine` is the fundamental bottom layer of the DAW; it should never know about UI or presentation logic. However, `AudioEngine/engine/TrackNode.ts` directly imports and invokes specific UI and Use Case logic from above:

- `import { isDeviceSupportedOnCurrentPlatform }` from `Arrangement/useCases/trackQueries`
- `import { registerLevainDevice }` from `Levain/useCases/levainParamBridge`
- `import { setEngineReady }` from `Levain/stores/levainStore`
  When the engine dynamically reaches up to a presentation store (like `Levain`) to call `setEngineReady(true)`, it creates a dangerous circular dependency. The engine should return a Promise to the orchestrator (or emit an EventBus event), allowing `Levain`'s own use-cases to update its own stores.

---

## P1 — Barrel Proliferation Continued

### 97. Additional Barrel Files Discovered

Three more unapproved `index.ts` re-exports were found deep in the remaining modules. These violate the "NO BARREL FILES" directive.

- `src/modules/Extension/useCases/extension/index.ts`
- `src/modules/Synth/useCases/cvGate/index.ts`
- `src/modules/Synth/useCases/drumSynthEngine/index.ts`

---

## P3 — Security and Extension Sandbox Risk

### 98. `Extension` Sandboxing via `new Function`

The `src/modules/Extension/useCases/extension/runEditorScript.ts` script uses `new Function('console', 'daw', code)` to execute user-provided extension code. While it attempts to sandbox via an isolated `console`, this is fundamentally insecure in a Desktop application context if third-party user extensions are allowed. It eventually needs to transition to a proper WASM sandboxed JS runtime like QuickJS to prevent node/fs exfiltration.

---

_Batch 6 total: 3 discrete architectural and security issues_  
_New P0: 1 | New P1: 1 | New P2: 0 | New P3: 1_

---

## Batch 7 — The Missed Corners and React 19 Violations

> Scope: Audited the skipped `Project` and `Collaboration` modules, ran a codebase-wide regex sweep for React Component macro-optimizations, and cataloged all remaining `index.ts` files.

---

## P1 — The True Scale of the Barrel File Problem

### 99. 57 Total `index.ts` Barrel Files

A comprehensive file system search reveals there are actually **57** `index.ts` files currently scattered across the `modules` directory (not just the 20 previously noted).
`Project`, `AudioEngine/repositories`, `MIDI`, and `AiRuntime` are currently acting as dense barrel networks. To achieve the 0-violation architectural state, every single one of these 57 files must be permanently deleted, and their imports updated across the entire codebase.

### 100. Uncategorized Root File in Modules Directory

Found a 0-byte stray file named `src/modules/createWebAudioEngine` sitting directly in the root of the modules folder. It is likely a leftover from an incomplete git migration or IDE error.

---

## P2 — Global `react19-compiler` Violations

### 101. Manual Memoization Prevalent Across the UI Layer

The official architectural rule explicitly states: _"The React Compiler is ACTIVE: Do NOT manually invoke useMemo, useCallback, or React.memo"_.
However, **15 different presentation components** across `Workspace`, `Fermenter`, `Toaster`, and `Arrangement` (e.g. `StepSequencer.tsx`, `XYPad.tsx`, `useTimelineInteractions.ts`) are still manually executing `useMemo()` and `useCallback()`. This causes conflicts with the React 19 compiler optimization path and creates unnecessary cognitive friction in the UI layer.

---

## P3 — The `Project` and `Collaboration` Modules

### 102. `Project` Module Over-Scoping

The `Project` module currently houses directories ranging from `/projectPersistence` and `/versionControl` to `/demoProjects` (where hardcoded JSON states for `cinematic`, `synthwave`, and `eightyEight` live). This strongly couples the static DAW template library directly into the core serialization module.

### 103. `Collaboration` Stubs

The `Collaboration` module operates entirely through empty stubs (`useCases/collaboration/index.ts`). There is no operational CRDT or WebSocket bridge hooked up to the `Transport` or `Workspace` stores yet.

---

_Batch 7 total: 5 discrete issues representing 70+ files_  
_New P0: 0 | New P1: 2 | New P2: 1 | New P3: 2_

---

## Absolute Final Grand Total

**103 issues identified across the entirety of the React/TypeScript Application.**  
_P0: 26 (Critical Boundary/State Violations)_  
_P1: 35 (57 Barrel Files & Root Structure)_  
_P2: 23 (UI Bloat & React 19 Memoization Violations)_  
_P3: 19 (Code Cleanliness, Security, & Architecture Smells)_

---

## Sympathy for the Devil: Why Quantitative Debt Accrued

An audit is fundamentally critical by nature, but it's important to recognize that many of these "violations" were likely rational, pragmatic choices made to prioritize feature velocity, performance, or debugging ease in a complex Real-Time browser application. Giving the current architecture its due consideration:

1. **Direct Store Access (The P0 Violations):** Building explicit use-case queries (`getTrackState()`) for every nested node is immense boilerplate. For reactive UI views (like the `Workspace`) that rely on `useSyncExternalStore` for React 19 performance, they need to pass the `Store` instance itself to the hook, not a derived snapshot. Exposing the store directly allows views to subscribe precisely, rather than forcing top-level context providers to re-render everything.

2. **The `AppAction.ts` 215-Member God Union (P1):** The Command module serves as the central nervous system. A single, exhaustive discriminated union of all `AppAction` payload shapes provides uncompromising type safety end-to-end. If an action isn't strictly defined in this union, it cannot be dispatched via shortcuts, MIDI mapped, or pushed to the Undo Tree. While monolithic and noisy, it gives both the TypeScript compiler and local LLM/Agentic routines a guaranteed, single source of truth for all valid commands.

3. **`AiRuntime` bypassing Commands to call `AiGeneration` directly:** The `Command` registry (`executeAppAction`) is designed for discrete, synchronous, reversible actions (Undo/Redo compatible). Generative AI tasks (like stem separation or generating MIDI tracks) are long-running, asynchronous operations that stream progress statuses. Funneling a streaming API through a static global event bus is highly complex; wiring `AiRuntime` views directly to `AiGeneration` promises allows for immediate, localized UX feedback (progress bars, spinners) without stalling the global queue.

4. **The "Full-Screen Invisible Div" Click-Outside (P2):** Complex z-indexing and event propagation in a DAW (where WebGL canvases, pointer lock APIs, and Web Audio context initializations compete for pointer events) render standard React `useOnClickOutside` hooks extremely fragile. Rendering a `fixed` invisible `div` directly underneath a popover is structurally ugly, but it is 100% bulletproof for intercepting an errant click before it triggers an accidental playhead jump or selection clear on the arrangement grid below.

5. **God Functions (`getProjectContext`):** The AI orchestration needs a snapshot of the _entire_ state world synchronously to build the LLM's system prompt context. Invoking 20 discrete queries introduces overhead. Grabbing the stores directly is the fastest, absolute way to serialize the entire application state reliably.

While these patterns must be systematically cleaned and abstracted to adhere to the `daw_architecture.md` rules, they clearly represent the natural friction of forcing a complex, high-performance, real-time Desktop-class environment into a standard Web/DOM React paradigm.
