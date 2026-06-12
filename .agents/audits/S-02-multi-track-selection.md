# Audit: S-02 Multi-Track Selection

## 1. Description of the Issue
The workspace currently operates under a single-track selection model. The application state stores this as `selectedTrackId: string | null` in `trackStore.ts`. However, modern DAWs require multi-track operations (e.g., bulk deletion, bulk freezing, routing modifications, and mass-dragging of clips). S-02 requires replacing this scalar value with an array or set, fundamentally altering how selection is broadcasted and consumed across the architecture.

## 2. Blast Radius & Impact Analysis
A codebase search reveals over **100+ occurrences** of `selectedTrackId`. The primary areas affected are:

### A. Application State & Models
- `trackStore.ts`: The definition of `TrackStoreState` and its default initialization.
- `TimelineRenderModel.ts`: The data model passed to the canvas rendering loop.
- `ProjectData.ts` (and related serialization/hydration files): Project load/save logic.

### B. Presentations & Views (UI)
Numerous React components read `selectedTrackId` to determine what to display:
- `TrackListView.tsx`: Determines the active style and handles `ArrowUp`/`ArrowDown` navigation.
- `InspectorPanel.tsx`, `Sidebar.tsx`, `AutomationBottomPanel.tsx`: Display properties for the "active" track.
- `PluginBrowser.tsx`, `ElasticEditorPanel.tsx`: Target the currently selected track for insertions/edits.
- **Problem:** Many of these panels fundamentally require a single "primary" target. If multiple tracks are selected, the UI must resolve which one's properties to display (typically the most recently selected).

### C. Use Cases & Handlers (Logic)
- `selectTrack.ts`: Needs to be replaced or extended to support multi-select modifiers (e.g., additive `Ctrl/Cmd` clicks, range `Shift` clicks).
- AI Generation Handlers (e.g., `handleGenerateMidiPrompt.ts`): Currently target the single `selectedTrackId`.
- Keyboard Shortcuts: `Delete` or `Backspace` currently trigger `removeTrack(selectedTrackId)`. This must become a bulk operation.

## 3. Proposed Refactoring Strategy

We propose a **Strict Architectural Refactor with a Primary Target Fallback**.

### Step 1: State Model Update
- Deprecate `selectedTrackId` and introduce `selectedTrackIds: string[]` in `trackStore.ts`.
- The array acts as a history-aware selection list. The **last element** in the array represents the "primary" or "most recently selected" track.

### Step 2: Use Case Evolution
- Introduce a new use case: `setTrackSelection(trackIds: string[], mode: 'replace' | 'add' | 'toggle' | 'range')`.
- Ensure that `TrackSelectionChangedEvent` broadcasts the array of selections rather than a single ID.

### Step 3: UI Fallback for Single-Target Panels
- Update `useTracks()` hook to return both `selectedTrackIds` and a derived `primaryTrackId` (i.e., `selectedTrackIds.at(-1)`).
- Panels that inherently operate on a single track (like the `InspectorPanel` or `PluginBrowser`) will bind to `primaryTrackId` to minimize UI disruption.
- Panels that support multi-selection (like `TrackListView`) will map over `selectedTrackIds` to render active states and handle bulk commands.

### Step 4: Bulk Operations
- Refactor `removeTrack` (or introduce `removeSelectedTracks`) to iterate over the array.
- Update global keyboard shortcuts to fetch `selectedTrackIds` and execute across the set.

## 4. Execution Plan
Given the high number of test files and isolated functions relying on the mock structures, this will be executed in phases:
1. **Phase 1: Core State & Use Cases** - Update `trackStore`, serialization, and the selection use cases.
2. **Phase 2: UI & Selectors** - Update `useTracks` and migrate single-target components to `primaryTrackId`.
3. **Phase 3: Multi-track Interactions** - Wire up `TrackListView` modifiers (Shift/Cmd) and update bulk actions (Delete).
4. **Phase 4: Tests** - Exhaustively fix all broken unit tests affected by the `selectedTrackId` removal.