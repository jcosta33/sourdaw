import { type ClipRenderModel } from './TimelineRenderModel';

/** The clip fields that place its content in time. */
export type InlineMidiTimingClip = Pick<
    ClipRenderModel,
    'startBeat' | 'endBeat' | 'loopEnabled' | 'loopLength' | 'midiOffsetBeats'
>;

/** The clip fields the inline MIDI geometry law reads. */
export type InlineMidiGeometryClip = InlineMidiTimingClip & Pick<ClipRenderModel, 'midiNotes'>;

/** Where a clip's note area sits, in whatever pixel space the caller works in (canvas or content). */
export type InlineMidiFrame = {
    x: number;
    width: number;
    contentTop: number;
    contentHeight: number;
};

/** Pitches the note area shows. The area has `pitchRange + 1` equal rows, the top row being `maxPitch`. */
export type MidiPitchWindow = {
    minPitch: number;
    maxPitch: number;
    pitchRange: number;
    rowHeight: number;
};

/** One drawn note, after loop repeats and clipping to the clip rectangle. */
export type MidiNoteRect = {
    noteId: string;
    pitch: number;
    x: number;
    y: number;
    width: number;
    height: number;
};

/** The position under a pointer: its arrangement beat, the source beat (the unit notes are stored in) and a pitch. */
export type InlineMidiPointer = {
    pointerBeat: number;
    noteBeat: number;
    pitch: number | null;
};

/**
 * The one law that places MIDI notes inside a clip's note area. The renderer
 * draws from it, the hit test finds notes through it and the draw tool turns a
 * pointer into a note through its inverse, so the three cannot disagree.
 *
 * Note `startBeat` is clip-relative source time. A note is drawn at
 * `startBeat - midiOffsetBeats` from the clip start, repeated every loop length
 * while the clip loops.
 */

/** A note area shorter than this is not drawn, so nothing in it can be hit. */
export const MIN_MIDI_CONTENT_HEIGHT = 4;

const MAX_LOOP_ITERATIONS = 100;
const MIDDLE_C = 60;
const OCTAVE = 12;
const MAX_MIDI_PITCH = 127;
const INLINE_NOTE_MIN_WIDTH = 2;
const PREVIEW_NOTE_MIN_WIDTH = 1;
const LOOP_FOLD_EPSILON = 1e-9;

/**
 * Inverse of the drawing law along time: the source note beat drawn at an
 * arrangement beat. A beat before the clip start reads as the start. The beat is
 * folded back through the loop length, then shifted by `midiOffsetBeats`, so a
 * note stored at the result is drawn at `arrangementBeat`.
 */
export const resolveInlineNoteBeat = (clip: InlineMidiTimingClip, arrangementBeat: number): number => {
    const clipDuration = clip.endBeat - clip.startBeat;
    const clipBeat = Math.min(Math.max(arrangementBeat - clip.startBeat, 0), clipDuration);
    const loopLen = clip.loopEnabled && clip.loopLength ? clip.loopLength : clipDuration;
    const offset = clip.midiOffsetBeats ?? 0;
    if (!clip.loopEnabled || loopLen <= 0) {
        return clipBeat + offset;
    }
    const folded = clipBeat % loopLen;
    // A beat on a loop boundary that division error leaves just short of it belongs to the next pass.
    return (loopLen - folded < LOOP_FOLD_EPSILON ? 0 : folded) + offset;
};

/**
 * Pitches shown for `notes`. Inline editing shows whole octaves from C, from the
 * one holding the lowest note to the one holding the highest, so drawing in a
 * visible row never moves the rows; an empty clip shows the octave from middle C.
 * Deleting the last note of an outer octave contracts the window.
 */
export const resolveMidiPitchWindow = (
    notes: InlineMidiGeometryClip['midiNotes'],
    inline: boolean,
    contentHeight: number
): MidiPitchWindow => {
    let minPitch = notes.length === 0 ? MIDDLE_C : MAX_MIDI_PITCH;
    let maxPitch = notes.length === 0 ? MIDDLE_C : 0;
    // A spread (Math.min(...notes.map())) can blow the call stack for clips with
    // very many notes, so the extent is folded in one loop.
    for (const node of notes) {
        if (node.pitch < minPitch) {
            minPitch = node.pitch;
        }
        if (node.pitch > maxPitch) {
            maxPitch = node.pitch;
        }
    }
    if (inline) {
        minPitch = Math.floor(minPitch / OCTAVE) * OCTAVE;
        maxPitch = Math.min((Math.floor(maxPitch / OCTAVE) + 1) * OCTAVE - 1, MAX_MIDI_PITCH);
    }
    const pitchRange = Math.max(maxPitch - minPitch, 1);
    return { minPitch, maxPitch, pitchRange, rowHeight: contentHeight / (pitchRange + 1) };
};

type NoteRectStyle = {
    inline: boolean;
};

/**
 * Calls `visit` for every note rectangle the clip draws, loop repeats included,
 * in iteration order. Scalars rather than objects: a clip can hold very many
 * notes and this runs every frame.
 */
export const forEachMidiNoteRect = (
    clip: InlineMidiGeometryClip,
    frame: InlineMidiFrame,
    window: MidiPitchWindow,
    style: NoteRectStyle,
    visit: (
        note: InlineMidiGeometryClip['midiNotes'][number],
        x: number,
        y: number,
        width: number,
        height: number
    ) => void
): void => {
    const clipDuration = clip.endBeat - clip.startBeat;
    if (clipDuration <= 0) {
        return;
    }
    const { x: clipX, width: clipW, contentTop, contentHeight } = frame;
    const { minPitch, pitchRange } = window;
    const loopLen = clip.loopEnabled && clip.loopLength ? clip.loopLength : clipDuration;
    const midiOffset = clip.midiOffsetBeats ?? 0;
    const minWidth = style.inline ? INLINE_NOTE_MIN_WIDTH : PREVIEW_NOTE_MIN_WIDTH;
    const heightInset = style.inline ? 1 : 0;

    let loopOffset = 0;
    let iterations = 0;
    while (loopOffset < clipDuration && iterations < MAX_LOOP_ITERATIONS) {
        for (const note of clip.midiNotes) {
            const relStart = note.startBeat - midiOffset + loopOffset;
            if (relStart >= clipDuration) {
                continue;
            }

            const nx = clipX + (relStart / clipDuration) * clipW;
            const nw = Math.max(minWidth, (note.duration / clipDuration) * clipW);
            const pitchNorm = (note.pitch - minPitch) / (pitchRange + 1);
            const ny = contentTop + contentHeight - (pitchNorm + 1 / (pitchRange + 1)) * contentHeight;
            const nh = Math.max(1, contentHeight / (pitchRange + 1)) - heightInset;

            if (relStart + note.duration > 0 && nx < clipX + clipW) {
                const finalX = Math.max(nx, clipX);
                const finalW = Math.min(nw - (finalX - nx), clipX + clipW - finalX);
                if (finalW > 0) {
                    visit(note, finalX, ny, finalW, nh);
                }
            }
        }
        loopOffset += loopLen;
        iterations++;
        if (!clip.loopEnabled || loopLen <= 0) {
            break;
        }
    }
};

/** The inline note area's pitch window, or null when the area is too short to be drawn. */
const resolveInlineWindow = (clip: InlineMidiGeometryClip, frame: InlineMidiFrame): MidiPitchWindow | null => {
    if (frame.contentHeight < MIN_MIDI_CONTENT_HEIGHT || clip.endBeat - clip.startBeat <= 0) {
        return null;
    }
    return resolveMidiPitchWindow(clip.midiNotes, true, frame.contentHeight);
};

/** The inline note whose drawn rectangle contains the point, or null. */
export const findInlineMidiNoteAt = (
    clip: InlineMidiGeometryClip,
    frame: InlineMidiFrame,
    pointerX: number,
    pointerY: number
): MidiNoteRect | null => {
    const window = resolveInlineWindow(clip, frame);
    if (!window) {
        return null;
    }
    let found: MidiNoteRect | null = null;
    forEachMidiNoteRect(clip, frame, window, { inline: true }, (note, x, y, width, height) => {
        if (found) {
            return;
        }
        if (pointerX >= x && pointerX <= x + width && pointerY >= y && pointerY <= y + height) {
            found = { noteId: note.id, pitch: note.pitch, x, y, width, height };
        }
    });
    return found;
};

/**
 * Inverse of the drawing law: the source beat and pitch row under a point in the
 * clip's note area. The beat is folded back through the loop length and
 * `midiOffsetBeats`, so a note stamped there is drawn under the pointer. Null
 * outside the note area; `pitch` is null when the pointer is outside the pitch rows.
 */
export const resolveInlineMidiPointer = (
    clip: InlineMidiGeometryClip,
    frame: InlineMidiFrame,
    pointerX: number,
    pointerY: number
): InlineMidiPointer | null => {
    const window = resolveInlineWindow(clip, frame);
    if (!window || frame.width <= 0) {
        return null;
    }
    const clipDuration = clip.endBeat - clip.startBeat;
    const clipBeat = Math.min(Math.max(((pointerX - frame.x) / frame.width) * clipDuration, 0), clipDuration);
    const pointerBeat = clip.startBeat + clipBeat;
    const noteBeat = resolveInlineNoteBeat(clip, pointerBeat);

    const depth = pointerY - frame.contentTop;
    if (depth < 0 || depth >= frame.contentHeight) {
        return { pointerBeat, noteBeat, pitch: null };
    }
    const row = Math.min(Math.floor(depth / window.rowHeight), window.pitchRange);
    return { pointerBeat, noteBeat, pitch: window.maxPitch - row };
};
