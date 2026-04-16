# Audit: Timeline and MIDI Editing Behavior

## Goal

The Timeline should provide a robust, visually accurate environment for arranging and editing audio and MIDI clips. This includes precise dragging, dropping, stretching, cutting, and looping behaviors, with accurate visual previews (waveforms and MIDI notes) at all times, including during interactions.

## Current State

The Timeline implementation uses a React-managed state with a Canvas-based renderer (`createCanvasRenderer.ts`). Interaction logic is primarily in `useTimelineInteractions.ts`, which uses a "preview" mechanism (`clipDragPreviewRef`) to provide high-performance visual feedback during drags without committing to the main store on every frame.

## Findings

- **MIDI notes are absolute**: MIDI notes in the `midiStore` are stored with absolute `startBeat` on the global timeline. While this simplifies playback scheduling, it complicates almost all editing operations (moving, splitting, stretching) as they must manually shift or scale all notes in the affected clips.
- **Editing operations ignore MIDI/Automation**: Operations like duplicating, nudging, ripple deleting, and inserting time only manipulate the clip boundaries in `trackStore` and fail to coordinate with `midiStore` or `automationStore`, resulting in massive data loss or desync.
- **Preview mechanism is incomplete**: The `clipDragPreviewRef` only stores new `startBeat` and `endBeat` for clips. The renderer (`drawMidiNotePreview`) uses these new boundaries but fetches original absolute notes, causing a visual mismatch during drags.
- **Waveform rendering is naive**: `drawWaveformPeaks` squashes the entire audio buffer into the clip's visual width, ignoring `audioOffsetBeats`, `stretchRatio`, and the clip's actual duration relative to the buffer.

## Issues

### 1. [CRITICAL] Widespread Time-Shift Desync and Data Loss

Many timeline operations shift clips in time without shifting their associated MIDI notes or automation points. Because MIDI notes and automation are stored in absolute time, they become desynced from the clips.

- **Files**:
    - `src/modules/Arrangement/useCases/clipEditing/nudgeClip.ts`
    - `src/modules/Arrangement/useCases/timeOperations/insertTime.ts`
    - `src/modules/Arrangement/useCases/clipEditing/deleteTimeRange.ts`
    - `src/modules/Arrangement/useCases/rippleDelete/rippleDeleteClips.ts`
- **Needed**: All clip movement logic must call `shiftClipMidiNotes` and `shiftClipAutomation` appropriately, or the underlying data model needs to be refactored so that notes/automation belong to the clip conceptually and use relative positioning.

### 2. [CRITICAL] MIDI Split/Cut Data Loss

When a MIDI clip is split using the Cut tool, the new "right" clip is created without any notes. The notes from the original clip remain associated with the "left" clip ID, but since the left clip's `endBeat` is now the split point, those notes are no longer visible or playable.

- **File**: `src/modules/Arrangement/useCases/clipEditing/splitClip.ts`
- **Needed**: `splitClip` must identify all notes within the original clip's range and re-associate/clone the notes that fall into the new right clip's range to the new clip ID.

### 3. [CRITICAL] MIDI Duplication Data Loss

Duplicating a MIDI clip creates a new clip ID and copies automation, but it completely fails to copy any MIDI notes to the new clip.

- **File**: `src/modules/Arrangement/useCases/clip/duplicateClipCore.ts`
- **Needed**: `duplicateClipCore` must read notes from `midiStore`, clone them with the new absolute `startBeat`, and associate them with the new clip ID.

### 4. [MAJOR] MIDI Drag Preview "Stay Behind" Bug

During a MIDI clip drag, the clip boundary (rectangle) moves with the mouse, but the MIDI note previews stay in their original positions. This is because `drawMidiNotePreview` calculates relative positions using the NEW clip `startBeat` but the OLD absolute note `startBeat`.

- **File**: `src/modules/Arrangement/presentations/renderers/clipDrawing.ts` (in `drawMidiNotePreview`)
- **Needed**: `drawMidiNotePreview` needs to know if a clip is being dragged and by how much, or `buildTimelineRenderModel` must shift the notes in the render model itself during the preview phase.

### 5. [MAJOR] Audio Waveform "Squash" Bug

The waveform renderer always shows the entire audio buffer squashed into the clip width. If a 1-bar clip points to a 10-minute file, the entire 10 minutes are rendered inside that 1 bar. It ignores `audioOffsetBeats` and `stretchRatio`.

- **File**: `src/modules/Arrangement/presentations/renderers/clipDrawing.ts` (in `drawWaveformPeaks`) and `src/modules/AudioEngine/stores/audioBufferCache.ts`
- **Needed**: `getWaveformPeaks` should accept `startSample` and `endSample` parameters. `drawWaveformPeaks` should calculate these based on `clip.audioOffsetBeats` and `clip.duration`.

### 6. [MAJOR] MIDI Stretching Not Implemented

Dragging the edge of a MIDI clip with the Stretch tool (or Shift+drag) only changes the clip's `endBeat` (trimming/extending). It does not scale the MIDI notes' positions or durations.

- **File**: `src/modules/Arrangement/useCases/clip/moveClip.ts` and `src/modules/Arrangement/handlers/clipStretch/handleSetClipStretchRatio.ts`
- **Needed**: Implement a `scaleClipMidiNotes(clipId, ratio)` use case that is called when a stretch operation is committed.

### 7. [MINOR] MIDI Looping Visual Distortion

When a MIDI clip is trimmed to be longer than its `loopLength`, `drawMidiNotePreview` visually stretches the notes to fit the new duration instead of repeating them correctly. This is due to using `relStart / clipDuration` as the X-coordinate.

- **File**: `src/modules/Arrangement/presentations/renderers/clipDrawing.ts` (in `drawMidiNotePreview`)
- **Needed**: Change the coordinate calculation to use `relStart * pixelsPerBeat` (absolute pixels from clip left) instead of a percentage of the width.

### 8. [MINOR] Missing Preview for Stretching/Trimming

While "move" drags have a robust preview, "stretch" and "trim" operations only update the clip boundary in the preview. MIDI notes and waveforms do not update their internal scaling/offset until the drag is released.

- **File**: `src/modules/Arrangement/useCases/buildTimelineRenderModel.ts`
- **Needed**: The preview model should support a `stretchRatio` or `visualOffset` that the drawing functions can respect.

## Priorities

1. **Fix Widespread Time-Shift Desync** (Critical - data loss during core timeline operations).
2. **Fix MIDI Split Data Loss** (Critical - data loss during editing).
3. **Fix MIDI Duplication Data Loss** (Critical - data loss during editing).
4. **Fix Audio Waveform "Squash"** (Major - fundamental visual correctness).
5. **Fix MIDI Drag Preview** (Major - UX / visual feedback).
6. **Implement MIDI Stretching** (Major - feature parity).

## Risks

- **Memory/Performance**: Fixing `getWaveformPeaks` to support arbitrary ranges might increase peak-generation overhead if not cached properly (e.g., via mipmaps).
- **Undo/Redo**: Fixing MIDI split/stretch requires careful coordination with the undo system to ensure notes are correctly restored.

## Suggested Approaches

- **Move to Relative MIDI Notes**: Consider changing the MIDI model to store notes relative to the clip start. This would automatically fix moving and simplify splitting/stretching, though it requires a migration and updates to the scheduler. If migration is impossible, ensure every clip modifier cleanly coordinates with `midiStore`.
- **Enhanced Render Model**: Update `ClipRenderModel` to include a `visualShift` or `visualScale` property that is populated by `buildTimelineRenderModel` during previews, allowing `clipDrawing.ts` to render correctly without touching the main store.
