# Transport Bar Redesign Audit

The existing `TransportBar.tsx` forces 11+ distinct functional component clusters into a single horizontal row. This forces the UI into horizontal compression, restricts the AI `PromptBar`, and creates cognitive fatigue by mixing DAW layout controls (like Sidebars) with musical editing controls (like the Playhead).

Moving to a **2-Row Architecture** creates intuitive horizontal strata.

---

## 🏗️ Proposed Semantic Grouping

### Row 1: The "Meta" Layer (Global Session & App State)
This top row should handle the project definition, the AI Copilot layer, and the application's window state. 

* **Left (Project Navigation):**
  * `ProjectName` & `RecentProjectsMenu`
  * `ArrangementSelector`
* **Center / Flexible (The Engine):**
  * `PromptBar` & `VoiceButton` (Allowing the generative AI text input to securely span the center without being crushed by metronome buttons).
* **Right (Application Layout):**
  * `PanelToggles` (Sidebar, Inspector, Mixer, Virtual Keyboard). 

### Row 2: The "Action" Layer (Timeline & Musical Transport)
This bottom row sits physically flush against the Arranger Timeline grid. Everything strictly related to editing clips, reading time, and controlling playback engines lives here.

* **Left (Editing Context):**
  * `UndoRedoButtons`
  * `ToolSelector` & `RippleEditing` (Pointer, Cut, etc.)
* **Center (Core Playback):**
  * `TransportControls` (Play, Stop, Record, Overdub, Loop)
  * `AutoScrollToggle`
  * `SoloModeSelector`
* **Right (Chronology):**
  * `PlayheadDisplay` (Time / Bars / Beats readout)
  * `TempoEditor`

---

## 🛠️ Required Technical Changes in `TransportBar.tsx`

1. **Flex Direction:**
   * Modify the root `<header>` to be a `flex-col` container. 
   * Ensure overall height adjusts appropriately (if CSS var `--spacing-transport-height` is currently 40px/48px, the header will now be double this height, e.g. `2 * var(...)`).
2. **Row Wrappers:**
   * Create two inner flexible rows: `<div className="flex w-full items-center justify-between ...">`.
3. **Visual Separation:**
   * Introduce a subtle `border-b` and shadow separator between Row 1 and Row 2.
   * `Sep` (vertical separator components) will remain, but only used inside groups within rows.
4. **Recording State Gradients:**
   * Currently, hitting Record changes the background gradient and border of the whole `header` to pulse amber/red.
   * We need to map this either globally to both rows, or strictly target Row 2 (the Musical Transport row) so the AI Prompt row stays visually neutral while recording.
