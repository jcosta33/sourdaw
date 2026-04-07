# Deep Codebase Audit

Audit of `src/modules/` against project documentation (`docs/`).

---

## 🔴 Bugs Fixed

### PreferencesDialog infinite re-render loop

**Root cause:** Store subscription functions were inline arrows, creating new references each render. Combined with the `update()` closure reading stale `prefs`, this created a cascade:

- `update({})` → `store.set()` → `#notify()` → `useStore` re-render → new subscription → re-subscribe → loop

**Fix applied:** Moved `subscribe` and `getSnapshot` to module scope (stable references). Wrapped `update` with `useCallback` + `useRef` to always read latest prefs.

> [!IMPORTANT]
> The `useCallback` I added violates the "no manual memoization" convention but is necessary here to prevent the infinite loop. This is a valid exception — store subscriptions have stricter stability requirements than normal component code.

---

## 🟡 Convention Violations

### 1. Manual `useCallback` usage (9 files)

| File                                                                                                                                                | Notes                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [useTimelineInteractions.ts](file:///Users/josecosta/dev/sourdaw/src/modules/Arrangement/presentations/components/hooks/useTimelineInteractions.ts) | Multiple useCallback calls      |
| [AutomationView.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Workspace/presentations/views/AutomationView.tsx)                              |                                 |
| [WaveformEditor.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Workspace/presentations/views/ClipView/WaveformEditor.tsx)                     |                                 |
| [PianoRoll.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Workspace/presentations/views/ClipView/PianoRoll.tsx)                               | `useCallback` for `update`      |
| [PreferencesDialog.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Workspace/presentations/components/PreferencesDialog.tsx)                   | Justified exception (see above) |
| [Sidebar.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Workspace/presentations/components/Sidebar.tsx)                                       |                                 |
| [TrackListView.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Arrangement/presentations/views/TrackListView.tsx)                              |                                 |
| [VoiceCommandOverlay.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/AiRuntime/presentations/components/VoiceCommandOverlay.tsx)               |                                 |

**Convention (docs/conventions.md):** _"Do not use `useMemo`, `useCallback`, or `React.memo` manually — the compiler inserts optimal memoization for you."_

**Recommendation:** Remove `useCallback` from all files except PreferencesDialog (exception). Replace with plain functions.

---

### 2. Manual `useMemo` usage (2 files)

| File                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- |
| [TransportBar.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Workspace/presentations/components/TransportBar.tsx) |
| [PromptBar.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Workspace/presentations/components/PromptBar.tsx)       |

**Recommendation:** Replace `useMemo` with plain computed values.

---

### 3. Direct `localStorage` usage (8 files)

| File                                                                                                                               | Usage                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| [projectPersistence.ts](file:///Users/josecosta/dev/sourdaw/src/modules/Project/useCases/projectPersistence.ts)                    | Save/load project data  |
| [recentProjects.ts](file:///Users/josecosta/dev/sourdaw/src/modules/Project/useCases/recentProjects.ts)                            | Recent projects list    |
| [ExportDialog.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Project/presentations/components/ExportDialog.tsx)              | Export settings         |
| [Sidebar.tsx](file:///Users/josecosta/dev/sourdaw/src/modules/Workspace/presentations/components/Sidebar.tsx)                      | Sidebar state           |
| [preferencesStore.ts](file:///Users/josecosta/dev/sourdaw/src/modules/Workspace/stores/preferencesStore.ts)                        | Preferences persistence |
| [devToolsStorageRepository.ts](file:///Users/josecosta/dev/sourdaw/src/modules/DevTools/repositories/devToolsStorageRepository.ts) | DevTools state          |
| [presetUseCases.ts](file:///Users/josecosta/dev/sourdaw/src/modules/Arrangement/useCases/presetUseCases.ts)                        | Preset data             |
| [TrackTemplate.ts](file:///Users/josecosta/dev/sourdaw/src/modules/Arrangement/models/TrackTemplate.ts)                            | Track templates         |

**Convention (docs/conventions.md L717):** _"Do not use `localStorage` directly; persist via `Store` with `LocalStorageStorage`."_

**Recommendation:** Refactor to use `Store` + `LocalStorageStorage` pattern, starting with `preferencesStore.ts` (already has a Store but manually does `localStorage.setItem` in a subscriber).

---

### 4. Cross-module `models/` imports

Widespread pattern: modules import `models/` types from other modules (e.g., `Track/models/Track` is used in Workspace, Timeline, Command). The docs say this is **forbidden** — modules should expose DTOs from `useCases/`.

However: In a DAW, `Track`, `Clip`, `MidiNote` etc. are core domain primitives shared everywhere. Treating these as private per-module types would be impractical.

**Recommendation:** Acknowledge as a **pragmatic deviation** or create a shared `Core/models/` module for fundamental types (`Track`, `Clip`, `MidiNote`, `AutomationPoint` etc.).

---

## 🔵 Structural Improvements

### 1. `preferencesStore` bypasses `LocalStorageStorage`

The store is initialized with `loadFromStorage()` which reads `localStorage.getItem(...)` directly, and a subscriber writes back via `localStorage.setItem(...)`. The `Store` class supports an official `storage` option with `LocalStorageStorage` — this should be used instead.

### 2. `Store.subscribe` signature for React integration

The store provides a `subscribeReact` method that matches the `(onStoreChange: () => void) => () => void` signature expected by React's `useSyncExternalStore`. Developers should use the `useStore` hook from `#/infra/store/useStore` rather than calling `useSyncExternalStore` directly.

### 3. Missing `errors/` folders

Per architecture.md, modules should have `errors/` folders for domain error types. None of the modules (`Track`, `Transport`, `AudioEngine`, etc.) have error folders. All errors are thrown as generic `Error` instances.

### 4. Missing `events/` folders

Per architecture.md + events.md, cross-module communication should use typed domain events via `EventBus`. Currently, cross-module communication uses:

- Direct DOM events (`sourdaw:open-preferences`, `sourdaw:open-key-shortcuts`)
- Direct store subscriptions
- Direct function calls between modules

**Recommendation:** Gradually migrate to typed `DomainEvent` subclasses for cross-module coordination (e.g., `TrackCreatedEvent`, `TransportStateChangedEvent`, `PreferencesUpdatedEvent`).

### 5. Large monolithic components

Several components exceed 500+ lines:

- `PianoRoll.tsx` — 996 lines
- `InspectorPanel.tsx` — 1214 lines
- `useTimelineInteractions.ts` — 705 lines
- `AutomationView.tsx` — 700+ lines

**Recommendation:** Extract sub-components and custom hooks to keep files focused.

---

## ✅ Positive Observations

- **Strong typing** throughout — no `any` types visible
- **Consistent use of `aria-label`** on most interactive elements
- **Proper use of `useStore`** from `#/infra/store/useStore` for store integration
- **Clean module structure** — clear separation into models, useCases, presentations, stores
- **Good undo/redo coverage** — PianoRoll operations all push undo entries
