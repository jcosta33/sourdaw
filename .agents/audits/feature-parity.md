# Audit: Professional DAW Feature Parity & Interaction Quality (Deep Dive)

**Goal:** Analyze the current codebase against "top-tier" professional DAW standards (Logic Pro, Ableton Live, Bitwig) to identify functional gaps, interaction shortcomings, and "Quality of Life" (QOL) needs. Provide an exhaustive catalog of implementation gaps and "wiring" shortcomings to guide the next phase of development.

## Current State Assessment

The application has a remarkably strong architectural foundation with advanced features like AI-assisted workflows (stem separation, MIDI continuation), a solid AudioEngine with VCA, Grouping, and Track Folders, and highly functional Piano Roll and Waveform editors. Notably, advanced features like Bounce in Place, Bounce to New Track, and Track Folders are already implemented as core commands.

However, the DAW lacks the "density of options," fine-grained interaction control, and workflow "snappiness" expected by professional users.

---

## 1. Deep-Dive: Arrangement & Timeline (`src/modules/Arrangement`)

### Current implementation analysis:
- **Tools:** Includes Select, Cut, Draw, Automation, and Stretch.
- **Track Features:** Track Folders, Grouping, Freezing, and Bouncing are fully supported.
- **Gaps:**
    - **Missing Essential Tools:** No Eraser, Glue (Join), Mute Tool, Zoom Tool, or Marquee Tool (range selection). Absence of a Marquee tool makes cross-track editing tedious.
    - **Snap Precision:** Snapping uses basic math. Missing "Snap to Zero Crossing" (critical for audio), "Relative Snapping," and "Snap to Automation Nodes/Markers."
    - **Fades:** Crossfades are basic linear overlaps. Missing curve control (S-Curve, Constant Power) and draggable fade handles directly on the clip.
    - **Global Tracks:** `TempoEditor` exists, but there are no dedicated Global Lanes in the main timeline for Time Signature or Markers.

### Wiring & Discoverability:
- **Keyboard Shortcuts:** Hardcoded in a massive switch statement (`handleKeydown.ts`). There is no centralized `ShortcutStore` or user-facing Command Registry where pros can customize their keybinds.

## 2. Deep-Dive: Automation System (`src/modules/Automation`)

### Current implementation analysis:
- **Curves:** `buildCurvePath` uses power-curves for tension and segment-based Catmull-Rom for "smooth."
- **Gaps:**
    - **Missing True Bezier:** Professional DAWs use cubic Bezier with interactive control points for every segment.
    - **No Automation Clips:** Automation is tied to tracks but lacks "Region/Clip" encapsulation, making it difficult to move arrangement sections with automation intact.
    - **Recording Modes:** Limited to basic Latch/Write. Missing "Trim" (relative adjustment) and "Relative" (non-destructive) modes.
    - **Data Density:** High-frequency recording creates massive point counts. Missing a "Thin Automation" algorithm.

### Wiring & Discoverability:
- **Context Menus:** Shape insertion exists in code but is only found in right-click submenus. No "Shape Tool" or "LFO Tool" in the main toolbar.

## 3. Deep-Dive: MIDI Editor (`src/modules/MIDI`)

### Current implementation analysis:
- **Quantization:** `quantizeNotes.ts` is a simple `Math.round`.
- **Gaps:**
    - **Missing Swing/Shuffle:** Essential for groove. No logic exists to offset even/odd beats.
    - **No Strength Control:** "Pro" users rarely want 100% quantization. Implementation needs a weight/strength factor.
    - **Legato/Overlap:** No use-cases for "Join Notes" or "Remove Overlaps," which are critical for instrument-specific MIDI programming (e.g., monophonic synths).
    - **Velocity Lane:** Exists as a separate lane but lacks "Transformation Handles" (e.g., scaling a selection of velocities with a ramp).

### Wiring & Discoverability:
- **Transformations:** `humanize` and `strum` are buried in context menus. Pro DAWs have a "MIDI Transform" inspector for iterative tweaks.
- **Inspector Depth:** The `InspectorPanel` adapts to Tracks, Clips, and Devices, but lacks a dedicated "Note Inspector" for precise MIDI tweaking.

## 4. Deep-Dive: Audio & Warp (`src/modules/Arrangement/useCases/warp`)

### Current implementation analysis:
- **Stretching:** Supports 4 modes but lacks phase-coherent multi-track warping.
- **Gaps:**
    - **Transient Detection:** No automatic detection. Users must manually double-click to add every warp marker. This is a massive "Pro" bottleneck.
    - **Slice to Sampler:** The wiring between the Waveform Editor and the Sampler is unidirectional. Missing "Slice at Transients to New Sampler Track."
    - **Formant Shifting:** Stretching repitches or uses complex math but lacks independent Formant control for vocal editing.

### Wiring & Discoverability:
- **Interaction:** Warp is a toggle in the editor. Pro DAWs often use "Alt-drag" on clip edges to trigger stretch directly from the arrangement.

## 5. Deep-Dive: Mixer & Routing (`src/modules/AudioEngine`)

### Current implementation analysis:
- **Routing:** Handled via `TrackNode` and `BusNode`.
- **Gaps:**
    - **The "Routing Matrix":** Users must use dropdowns on individual strips. No global "Patchbay" view for complex routing.
    - **Sidechaining:** Hardcoded to a specific "sidechain-compressor" worklet. Pro DAWs allow any plugin to receive sidechain inputs from any track.
    - **Metering Depth:** Basic peak meters only. Professional mixing requires LUFS (EBU R128) and RMS for loudness standards.

### System-Wide QOL & UX "Snappiness":
- **[CRITICAL] "Alt-Click" Discipline:** Missing "Reset to Default" on almost all shared UI knobs/faders (`Fader.tsx`, `RotaryKnob.tsx`).
- **Feedback:** Fades and Warp markers lack hover states and parameter tooltips during drag operations.

---

## Actionable Priority for Implementing Agent

### Phase 1: Interaction Foundation [CRITICAL]
- [ ] **Alt-Click Reset:** Add `onPointerDown` with `altKey` check to `RotaryKnob` and `Fader` to reset to default value.
- [ ] **Shortcut Centralization:** Move hardcoded shortcuts from `handleKeydown.ts` into a customizable `ShortcutStore`.

### Phase 2: MIDI & Automation Depth [HIGH]
- [ ] **Groove Quantize:** Expand `quantizeNotes.ts` to support `swing` and `strength` parameters.
- [ ] **Automation Curves:** Upgrade `buildCurvePath` to implement interactive Cubic Bezier paths.
- [ ] **Velocity Lane Polish:** Add transformation ramp handles to the Velocity Lane in the Piano Roll.

### Phase 3: Workflow "Snappiness" [MEDIUM]
- [ ] **Marquee Tool:** Implement a new tool type for range-based selection and deletion across multiple tracks.
- [ ] **Peak Hold:** Update `MixerLevelReadout` to include persistent peak-hold and clip-reset on click.
- [ ] **Snap to Zero Crossing:** Implement audio buffer analysis during drag operations to snap to the nearest zero-crossing point.
