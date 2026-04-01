# TransportBar Audit

**Date:** 2026-04-01  
**Scope:** Every UI element rendered by `TransportBar.tsx` and all child components, hooks, and wired use cases.  
**Goal:** Identify what each element does, how it is wired, and whether it is fully functional, partially wired, or purely cosmetic.

---

## Structure Overview

`TransportBar` is a `<header>` with two rows:

| Row | Section | Purpose |
|---|---|---|
| Row 1 (meta layer, 40px) | Left wing | Project name, recent projects, arrangement selector |
| Row 1 | Center | AI PromptBar + VoiceButton |
| Row 1 | Right wing | PanelToggles + Preferences |
| Row 2 (action layer, 46px) | Left wing | PlayheadDisplay + TempoEditor |
| Row 2 | Center | TransportControls (all playback buttons) |
| Row 2 | Right wing | AutoScrollToggle, SoloModeSelector, ToolSelector+Ripple, UndoRedoButtons |

---

## Row 1 — Meta Layer

### `ProjectName` — ✅ Fully Functional
**File:** `views/Transport/ProjectName.tsx`  
**Data source:** `useProjectState()` → `projectStore`

- Displays the current project name in a recessed badge.
- Clicking enters rename mode (inline `<input>`).
- Double-clicking triggers `saveProject()`.
- An animated orange dot appears when `dirty === true` (unsaved changes).
- `renameProject(value.trim())` is called on commit (Enter / blur).

**Issues:** The `<input>` in edit mode does not use React Hook Form + Zod (AGENTS.md violation — all inputs should use RHF+Zod). It uses `useState` directly with no validation schema. Name is not trimmed for max-length either.

---

### `RecentProjectsMenu` — ✅ Functional (external component, not audited here)
**File:** `src/modules/Project/presentations/views/RecentProjectsMenu.tsx` (11 986 bytes, external to Workspace)

Not co-located with Workspace — imported from `Project` module's `presentations/views/`. This is a cross-module view import, which is acceptable since it is a `presentations/views/` contract folder.

---

### `ArrangementSelector` — ✅ Fully Functional
**File:** `src/modules/Project/presentations/views/ArrangementSelector.tsx`  
**Data source:** `arrangementStore`

- Renders current arrangement name in a dropdown button.
- Dropdown lists all arrangements with active checkmark.
- Supports: switch, create new, duplicate, rename (inline edit on double-click / edit icon).
- Uses `useEffect` for click-outside and Escape key handling. ⚠️ Naming collision risk: `useEffect` for data fetching is banned, but these are event listener effects which are fine — however, the effect deps array `[open, editingId]` for the escape key handler mixes concerns.
- **Note:** `ArrangementSelector` is in `Project/presentations/views/`, not `Workspace`. It directly calls Arrangement use cases (`switchArrangement`, `createArrangement`, etc.) — this is a correct DDD path since both are in their own module's use case layer.

---

### `PromptBar` — ✅ Fully Functional (mostly)
**File:** `views/PromptBar.tsx`  
**Hook:** `usePromptExecution.ts` (390 lines, very thorough)

This is the AI command centre. It has three UI states:

1. **Preview mode:** Shows planned actions as chips with Accept/Cancel buttons.
2. **Search mode (focused):** Shows fuzzy-matched preset commands in a dropdown listbox.
3. **Normal mode:** Input with Zap (preset) or Brain (LLM) icon.

**Features:**
- Fuzzy preset search with keyboard navigation (↑↓ Tab Enter Escape).
- Selection context tags (selected track / clip / clips) displayed as removable chips.
- LLM status badge + model load button via `LlmStatusBadge`.
- Abort button during AI processing.
- Voice injection listener (`onPromptInjection` event → auto-submit).
- History button (toggles `aiActionHistoryPanel`).
- Actions are executed via `executeAppAction` and logged to `aiActionHistoryStore`.

**Issues:**
- `useEffect` at line 143 for resetting dismissed tags when selection changes: `deps: [selectedTrackId, selectedClipId, selectedClipIds]`. The `selectedClipIds` is an array derived in render — this will cause the effect to fire every render because the array reference is new each time. This is a real memoisation bug (the React Compiler *might* fix this, but it is risky since arrays constructed inline are not guaranteed stable).
- Missing `aria-activedescendant` on the `<Input>` even though `aria-controls="prompt-results"` and `aria-expanded` are set. Screen readers won't announce the focused item in the listbox.
- `FuzzyResultItem` buttons don't have IDs, so `aria-activedescendant` can't point to them anyway.

---

### `VoiceButton` — ⚠️ Partially Wired
**File:** `components/Transport/VoiceButton.tsx`  
**Architecture Note:** Lives in `presentations/components/` (private), but imported directly from `TransportBar` which is in `presentations/views/`. This is fine — views can import components within the same module.

- Dispatches `sourdaw:toggle-voice-command` CustomEvent on click.
- Tooltip states "Voice command (hold V)".

**Issues:**
- There is **no visual feedback** when the microphone is active. The button renders identically regardless of whether voice recording is happening. The `sourdaw:toggle-voice-command` event fires into the void with no confirmed subscriber shown in the `Workspace` module's view layer.  
- The tooltip says "hold V" but the button is a click — there is no `mousedown`/`mouseup` (push-to-talk) behaviour; it fires a toggle on click.
- No `aria-pressed` state.
- Lives in `presentations/components/Transport/` (private to Workspace module) but the companion `TransportBar` view (also Workspace) imports it — not an architecture violation, but the button does nothing useful without the voice pipeline listener.

---

### `Sep` (separator) — ✅ Cosmetic, intended
An internal `<div>` with a gradient — purely decorative. No logic issues.

---

## Row 1 — Right Wing

### `PanelToggles` — ✅ Fully Functional
**File:** `views/Transport/PanelToggles.tsx`  
**Data:** `workspaceStore` (via props) + `aiStore` (internal `useSyncExternalStore`)

Eight toggle buttons in a grouped `role="group"`:

| Button | Icon | Toggle fn | Shortcut | Status |
|---|---|---|---|---|
| Track List | ListOrdered | `toggleTrackList` | ⌘T | ✅ |
| Browser (sidebar) | PanelLeft | `toggleSidebar` | ⌘B | ✅ |
| Inspector | PanelRight | `toggleInspector` | ⌘I | ✅ |
| Bottom Dock (mixer) | PanelBottom | `toggleMixer` | ⌘M | ✅ |
| Virtual Keyboard | Piano | `toggleVirtualKeyboard` | ⌘⇧K | ✅ |
| AI Chat | MessageSquare | `toggleChatPanel` | ⌘J | ✅ |
| AI Generate | Sparkles | `toggleAiPanel` | — | ✅ |
| Preferences | Settings2 | `document.dispatchEvent(new Event('sourdaw:open-preferences'))` | ⌘, | ⚠️ |

**Issues:**
- **Preferences** uses a raw `document.dispatchEvent` call inside the view, bypassing the use case layer entirely. Should be extracted to a use case (e.g., `openPreferences.ts`).
- The AI Generate button subscribes directly to `aiStore` via `useSyncExternalStore` inside `PanelToggles` instead of receiving the value as a prop. This means `PanelToggles` has a hidden cross-module store dependency (`AiGeneration`) — a mild concern for testability but not an architecture violation since it's a `presentations/views/` component.
- The tooltip for AI Generate only says "Generate" with no keyboard shortcut listed.

---

## Row 2 — Left Wing

### `PlayheadDisplay` — ✅ Fully Functional (performance-optimised)
**File:** `views/Transport/PlayheadDisplay.tsx`  
**Data:** `playheadPositionRef` (non-reactive, updated at RT) + `transportStore` (for `isPlaying`)

This component uses a `requestAnimationFrame` loop to write directly to DOM `span` refs — bypassing React's re-render system entirely during playback. This is the correct pattern for high-frequency position updates.

Two display modes, toggled by clicking the component:
- **Musical** (`Bars`): `Bar.Beat.Tick` (tick = fraction of a beat * 480)
- **Time** (`Time`): `MM:SS.ms`

Toggle is handled by `toggleTimeDisplayMode` (workspace use case).

**Issues:**
- `playheadPositionRef.current` is read directly at render time (lines 97-103) to compute initial values for SSR/first paint — but this value is the same ref also written by the rAF loop, so on first render the displayed value matches reality. However, the rendered JSX sets initial `textContent` via JSX interpolation, and then the rAF loop overwrites it via `.textContent` mutation. This means React's reconciler and the rAF loop both own the same DOM node. This works but is fragile — a React reconciliation triggered from an unrelated state change could reset the span content to the stale `{bar}` value before rAF corrects it again.
- `// eslint-disable-next-line react-hooks/exhaustive-deps` suppresses a lint rule on line 93. The effect deps `[isPlaying, isMusical]` are correct but the suppression is a red flag for future maintainers.
- The component is duplicated into two separate return branches (musical vs time) with near-identical JSX — a refactor to a single branch with conditional formatting function would reduce ~80 lines.

---

### `TempoEditor` — ✅ Fully Functional
**File:** `views/TempoEditor.tsx`  
**Hook:** `useTempoEditorState.ts`

Contains:
1. **BPM `ValueField`** — drag to scrub, Shift for fine precision, double-click to reset to 120. Min=20, Max=300.
2. **Tempo Map button (🗺)** — opens an inline popover showing all tempo change events.
3. **TAP button** — tap up to 8 times; uses `performance.now()` averaging, 4-second timeout window. Fires `setTempo(bpm)` when ≥2 taps.
4. **Time Signature display / edit** — click to enter inline numerator (1–32) + denominator (select: 2/4/8/16) edit. Commits via Enter/blur, cancels on Escape.
5. **Tempo Map popover** — lists existing tempo changes (beat, BPM, curve). Each entry is inline-editable. Can add new entries (beat + BPM + curve type: instant/linear). Entries can be deleted with Trash icon.

**Issues:**
- The tempo map popover uses a `document.addEventListener('mousedown', handleClickOutside)` inside `useEffect` for click-outside — fine, but the `mapPanelRef` is typed as `RefObject<HTMLDivElement | null>` yet `useRef<HTMLDivElement>(null)` is called without the `| null` (line 71). This is a TypeScript drift that could cause stale-ref issues.
- Time signature inline edit uses raw `<Input>` and `<select>` (native) without RHF+Zod — same form engineering violation as `ProjectName`.
- The Tempo Map popover's "add" form likewise uses raw `<Input>` state, violating the form engineering skill.
- `setDenValue` accepts a `string` but is used in a `<select>` — works, but not typesafe.
- `useTempoEditorState` calls `useTransportState()` internally, which is fine, but `TempoEditor` renders in `TransportBar` without memoization — since the React Compiler handles this, it should be OK.

---

## Row 2 — Center

### `TransportControls` — ✅ Mostly Functional (several stubs)
**File:** `views/Transport/TransportControls.tsx`

This is the playback control grouping. All buttons use `LatchButton` (toggle variant) or `Button` from the shared component library.

| Element | Icon | State | Handler | Status |
|---|---|---|---|---|
| Play/Pause | Play/Pause | `isPlaying` | `togglePlayback` (Space) | ✅ Wired |
| Stop | Square | — | `stopPlayback` (Esc) | ✅ Wired |
| Record | Circle | `isRecording` | `toggleRecording` (R) | ✅ Wired |
| Audio Record LED | LED red | `isAudioRecording` | display only | ✅ Wired |
| Loop | Repeat | `isLooping` | `toggleLoop` (L) | ✅ Wired |
| Overdub | Layers | `overdubEnabled` | `toggleOverdub` (+) | ⚠️ Partially wired |
| Link Sync | Link | `linkEnabled` | `enableLink`/`disableLink` (async) | ⚠️ Partially wired |
| Link LED | LED amber | `linkEnabled` | display only | ⚠️ (depends on Link) |
| Metronome | SVG pendulum | `metronomeEnabled` | `toggleMetronome` (M) | ✅ Wired |
| Metronome Volume | Slider | `metronomeVolume` | `setMetronomeVolume` | ✅ Wired (shown only when metronome on) |
| Punch In/Out | Scissors | `punchInEnabled` | `togglePunchEnabled` (I) | ✅ Wired |
| Count-in | ListOrdered | `countInEnabled` | `toggleCountIn` | ✅ Wired |
| Pre-roll | "PRE" text | `preRollEnabled` | `togglePreRoll` | ⚠️ Partially wired |

#### Overdub (`overdubEnabled`) — ⚠️ STUB
- `toggleOverdub` sets the flag in `transportStore`.
- Consumers: `recording.ts` in the Arrangement module reads `overdubEnabled` to decide whether new MIDI notes should merge (`overdub`) or replace. Also consumed in `webMidi/messageHandlers.ts`.
- The flag is correctly persisted, but the actual overdub merging logic in `recording.ts` should be verified — the MIDI overdub merge path exists but may not be hooked through to all clip types.

#### Ableton Link (`linkEnabled`) — ⚠️ PARTIALLY WIRED
- `enableLink()` / `disableLink()` call through to `AudioEngine/useCases/engineAccess`.
- The `linkStatusStore` is the source of truth for the LED and button state.
- The actual Link networking (Tauri side) exists if the Rust crate is integrated; otherwise this is a graceful no-op.
- The `handleLinkToggle` has a `catch {}` that silently swallows all errors.
- Comment on line 59 ("Since engine update might not be instant, we can optimistically disable it") is misleading — there is no optimistic update; the UI waits for the store to update reactively.

#### Punch In/Out (`punchInEnabled`) — ✅ WIRED
- `playheadScheduler.ts` checks `punchInEnabled`, `punchInBeat`, `punchOutBeat` each tick.
- Auto-starts recording at `punchInBeat` and stops at `punchOutBeat`.
- Punch region definition (set `punchInBeat`/`punchOutBeat`) is done via separate use cases but **there is no UI in the TransportBar to set the punch points** — users must set them elsewhere (timeline ruler, or via AI commands).
- The Scissors icon communicates "cut/punch" semantically — reasonable.

#### Count-in (`countInEnabled`) — ✅ WIRED
- `toggleRecording.ts` reads `countInEnabled` and `countInBars`.
- If enabled: schedules `countInBars * beatsPerBar` metronome clicks via Web Audio before starting actual recording while playing the scheduled notes.
- `countInBars` default is 1 bar. No UI to change bar count from the transport bar — only via AI commands (`setCountInBars`). 

#### Pre-roll (`preRollEnabled`) — ⚠️ PARTIALLY WIRED
- `startPlayback.ts` reads `preRollEnabled` and `preRollBars` on playback start.
- If enabled: rewinds playhead by `preRollBars * numerator` beats before the cursor position.
- `preRollBars` default is 2 bars. No UI to edit the bar count from the transport bar.
- Pre-roll logic only fires on `startPlayback`, not on `toggleRecording` directly — so if recording is triggered before playback starts, pre-roll may not fire.

#### Record button's LED indicator
- `isAudioRecording` comes from `useAudioRecordingState()` → `audioRecordingStore`.
- This is a **separate signal** from `transport.isRecording` (which is the MIDI/session record arm state).
- The LED (`<LED on={isAudioRecording} variant="red" size="sm" />`) correctly shows actual hardware capture status.
- The record `LatchButton` shows `transport.isRecording` (session arm). Both can differ (transport armed but hardware not capturing yet, or vice versa during count-in delay).

---

## Row 2 — Right Wing

### `AutoScrollToggle` — ✅ Fully Functional
**File:** `views/Transport/AutoScrollToggle.tsx`  
**Data:** `timelineViewStore.autoScrollEnabled`

- Self-contained — subscribes directly to `timelineViewStore` (internal to Arrangement module).

**Architecture issue:** `AutoScrollToggle` is in `Workspace/presentations/views/Transport/` but imports directly from `Arrangement/stores/timelineViewStore`. `stores/` is a contract boundary so this is acceptable, but the function `toggleAutoScroll` is imported from the same store file (`timelineViewStore`) rather than from an `Arrangement/useCases/` file. This is a minor violation of the "One Function Per File" and "Repositories Touch Metal" rules. The toggle logic should live in a use case.

---

### `SoloModeSelector` — ✅ Fully Functional
**File:** `views/Transport/SoloModeSelector.tsx`  
**Data:** `soloMode` prop from `workspaceStore`

- Renders three radio-group buttons: SIP / AFL / PFL.
- `setSoloMode(m.value)` updates `workspaceStore`.
- `applySoloLogic()` (in `Arrangement/services/`) reads `soloMode` from `workspaceStore` when recalculating mute/gain states.

**Issues:**
- **AFL (After Fader Listen)** mode: `applySoloLogic.ts` handles SIP and PFL explicitly but **has no dedicated AFL branch**. Looking at the code (line 74): the `else` branch handles SIP logic (mute non-soloed tracks) but AFL is supposed to monitor the signal *after* the fader (same gain as fader, not unity like PFL). Currently AFL is treated identically to SIP — this is a **functional bug** / stub.
- The `role="radiogroup"` + `role="radio"` pattern is correct.

---

### `ToolSelector` (+ Ripple toggle) — ✅ Fully Functional
**File:** `views/ToolSelector.tsx`  
**Data:** `workspaceStore.activeTool` via `useWorkspaceState()`

Five tools in a radio group: `select`, `cut`, `draw`, `automation`, `stretch`.

- `setEditingTool(tool)` updates `workspaceStore.activeTool`.
- When `rippleEditing` prop is provided, a separator and "R" toggle button appear.
- `onToggleRipple` → `toggleRippleEditing` (from `Workspace/useCases/rippleEditing.ts`).

**Ripple editing:** Fully implemented — `rippleDeleteClips` shifts subsequent clips left on delete. The undo path (`undoRippleDelete`) also exists.

**Issues:**
- `ToolSelector` calls `useWorkspaceState()` internally (line 26) **despite also receiving `rippleEditing` and `onToggleRipple` as props**. This creates a mixed prop/hook data fetching pattern. The `activeTool` could be passed as a prop for consistency and testability (the component currently has two sources of truth for workspace data).
- The `stretch` tool is listed in `TOOLS` and has an icon, but its actual behavior in the arrangement renderer needs verification — stretch/time-scale editing may be a stub.

---

### `UndoRedoButtons` — ✅ Fully Functional
**File:** `views/Transport/UndoRedoButtons.tsx`  
**Data:** `useUndoState()` → `undoStore`

- Undo (⌘Z) → `undo()` from `Command/useCases/undoRedo`.
- Redo (⌘⇧Z) → `redo()`.
- Both are disabled when `canUndo`/`canRedo` is false.
- `useUndoState` also exposes `lastAction` and `undoCount` which are computed but **not used by UndoRedoButtons** — they're unused exports in the hook. Could be used for a tooltip showing "Undo: Set tempo to 120 BPM".

---

## TransportBar Root — Issues

### State Management — Mostly Correct
- `useWorkspaceState()`, `useTransportState()`, `useAudioRecordingState()`, `useUndoState()`, `useProjectState()` are all `useSyncExternalStore` hooks — correct pattern.
- `useSyncExternalStore(subscribeTrackStore, getTrackStoreSnapshot)` is defined with stable references (`subscribeTrackStore` and `getTrackStoreSnapshot` as module-level consts). This is correct.

### Architecture Violations

1. **`TransportBar` directly imports `trackStore`** (`#/modules/Arrangement/stores/trackStore`) to compute `anyTrackArmed`. Stores are a contract boundary so the import is technically allowed, but the `anyTrackArmed` computation (`tracks.some(t => t.armed)`) is business logic that belongs in a use case or a selector. A `useAnyTrackArmed` hook or `getAnyTrackArmed()` use case should encapsulate this.

2. **`TransportBar` imports `toggleRippleEditing` from `Workspace/useCases/rippleEditing.ts`** and passes it as `onToggleRipple` to `ToolSelector`. This is correct — use case in the same module, passed as a prop.

3. **Cross-module view import:** `ArrangementSelector` and `RecentProjectsMenu` are imported from `Project/presentations/views/` — these are `views/` which are public contract boundaries, so this is fine.

### Inline Styles vs. Tailwind v4
- All components use a mix of inline `style={{}}` objects for gradients/shadows and Tailwind classes for spacing/layout.
- The AGENTS.md rule says "No custom CSS outside `main.css`" — the inline styles across every component here technically violate this rule. However, these are dynamic styles (some depend on `isRecording` state) and can't easily be expressed as static Tailwind utilities without CSS custom properties. The recording state gradient on `TransportBar` is a good candidate for a CSS custom property animation instead.
- Static gradient styles in `PanelToggles`, `UndoRedoButtons`, `SoloModeSelector`, etc. should be centralised into `main.css` as reusable classes (e.g., `.surface-recessed`).

---

## Summary Table

| Element | Component | Wired | Functional | Issues |
|---|---|---|---|---|
| Project name + rename | `ProjectName` | ✅ | ✅ | Missing RHF+Zod validation |
| Dirty indicator | `ProjectName` | ✅ | ✅ | — |
| Recent projects menu | `RecentProjectsMenu` | ✅ | ✅ | Not audited in depth |
| Arrangement selector | `ArrangementSelector` | ✅ | ✅ | useEffect dep concern |
| AI PromptBar | `PromptBar` | ✅ | ✅ | Array deps bug, missing aria-activedescendant |
| Voice command button | `VoiceButton` | ⚠️ | ⚠️ | No active state, no push-to-talk, no subscriber confirmed |
| Track list toggle | `PanelToggles` | ✅ | ✅ | — |
| Browser toggle | `PanelToggles` | ✅ | ✅ | — |
| Inspector toggle | `PanelToggles` | ✅ | ✅ | — |
| Bottom dock toggle | `PanelToggles` | ✅ | ✅ | — |
| Virtual keyboard toggle | `PanelToggles` | ✅ | ✅ | — |
| AI Chat toggle | `PanelToggles` | ✅ | ✅ | — |
| AI Generate toggle | `PanelToggles` | ✅ | ✅ | Cross-module store dep inside view |
| Preferences button | `PanelToggles` | ⚠️ | ⚠️ | Uses `document.dispatchEvent` — no use case |
| Playhead display | `PlayheadDisplay` | ✅ | ✅ | React+rAF dual DOM ownership, code duplication |
| BPM drag field | `TempoEditor` | ✅ | ✅ | — |
| Tap tempo | `TempoEditor` | ✅ | ✅ | — |
| Tempo map panel | `TempoEditor` | ✅ | ✅ | Raw inputs, no RHF+Zod |
| Time signature | `TempoEditor` | ✅ | ✅ | Raw inputs, no RHF+Zod |
| Play/Pause | `TransportControls` | ✅ | ✅ | — |
| Stop | `TransportControls` | ✅ | ✅ | — |
| Record | `TransportControls` | ✅ | ✅ | — |
| Audio record LED | `TransportControls` | ✅ | ✅ | — |
| Loop | `TransportControls` | ✅ | ✅ | — |
| Overdub | `TransportControls` | ⚠️ | ⚠️ | Flag set; MIDI overdub merge needs verification |
| Ableton Link | `TransportControls` | ⚠️ | ⚠️ | Silent error swallow; optimistic comment misleading |
| Link LED | `TransportControls` | ⚠️ | ⚠️ | Depends on Link being wired |
| Metronome | `TransportControls` | ✅ | ✅ | — |
| Metronome volume | `TransportControls` | ✅ | ✅ | — |
| Punch In/Out toggle | `TransportControls` | ✅ | ✅ | No UI to set punch points from transport bar |
| Count-in toggle | `TransportControls` | ✅ | ✅ | No UI to set bar count from transport bar |
| Pre-roll toggle | `TransportControls` | ⚠️ | ⚠️ | Only fires on startPlayback; doesn't apply when record is armed first |
| Auto-scroll | `AutoScrollToggle` | ✅ | ✅ | `toggleAutoScroll` should be in a use case not store file |
| Solo mode (SIP/AFL/PFL) | `SoloModeSelector` | ✅ | ⚠️ | AFL not implemented — treated same as SIP |
| Select tool | `ToolSelector` | ✅ | ✅ | — |
| Cut tool | `ToolSelector` | ✅ | ✅ | — |
| Draw tool | `ToolSelector` | ✅ | ✅ | — |
| Automation tool | `ToolSelector` | ✅ | ✅ | — |
| Stretch tool | `ToolSelector` | ✅ | ⚠️ | Renderer integration needs verification |
| Ripple edit toggle | `ToolSelector` | ✅ | ✅ | — |
| Undo | `UndoRedoButtons` | ✅ | ✅ | Could show last action label in tooltip |
| Redo | `UndoRedoButtons` | ✅ | ✅ | — |

---

## Priority Issues to Address

### 🔴 Functional Bugs
1. **AFL solo mode is a stub** — `applySoloLogic.ts` treats AFL identically to SIP. The After Fader Listen behaviour (route soloed tracks to a monitoring bus at their fader gain, not unity) is missing.
2. **Pre-roll doesn't fire on `toggleRecording`** — it only rewinds the cursor in `startPlayback`. If the user arms tracks and hits Record without Play first, pre-roll is skipped.

### 🟠 Partially Wired / Silent Stubs
3. **VoiceButton** has no active state. No confirmed listener in `Workspace` module for the `sourdaw:toggle-voice-command` event. Should reflect active recording visually (pulsing mic icon, `aria-pressed`).
4. **Ableton Link** silently swallows errors. Optimistic update comment is wrong.
5. **Overdub** flag is set but MIDI overdub merge in `recording.ts` should be verified for all clip types.

### 🟡 Architecture & Code Quality
6. **`PanelToggles` Preferences button** calls `document.dispatchEvent` directly — needs an `openPreferences` use case.
7. **`AutoScrollToggle` imports `toggleAutoScroll`** from a store file — should be a use case.
8. **`TransportBar` computes `anyTrackArmed`** inline from raw store data — should be a selector/use case.
9. **Inline styles** are pervasive — the recessed surface treatment (dark gradient + inset shadow + border) appears in at least 8 components with copy-pasted style objects. Should be a shared CSS class (`.daw-surface-recessed`).
10. **`PlayheadDisplay` dual DOM ownership** — React JSX and rAF loop both write to the same span DOM nodes. A re-render from any parent state change will overwrite the rAF-written content until the next rAF fires (~16ms flicker risk).
11. **Form engineering violations** — `ProjectName` and `TempoEditor` use raw `useState` inputs instead of React Hook Form + Zod schemas.
12. **`ToolSelector` mixed prop/hook pattern** — `activeTool` read from store internally while `rippleEditing` is passed as prop.
13. **`usePromptExecution`** — `selectedClipIds` (array derived at render) in effect deps may cause spurious re-runs.
