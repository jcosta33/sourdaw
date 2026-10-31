import { type ClipRenderModel } from './TimelineRenderModel';

/** The clip fields the inline MIDI geometry law reads. */
export type InlineMidiGeometryClip = Pick<
    ClipRenderModel,
    'startBeat' | 'endBeat' | 'midiNotes' | 'loopEnabled' | 'loopLength' | 'midiOffsetBeats'
>;

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

/** The note-space position under a pointer: a source beat (the unit notes are stored in) and a pitch. */
export type InlineMidiPointer = {
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
const MIN_INLINE_PITCH_SPAN = 12;
const MAX_MIDI_PITCH = 127;
const INLINE_NOTE_MIN_WIDTH = 2;
const PREVIEW_NOTE_MIN_WIDTH = 1;

/**
 * Pitches shown for `notes`. Inline editing pads the extent and shows at least
 * an octave; an empty inline clip shows the octave around middle C, exactly as
 * a one-note clip at middle C does.
 */
export const resolveMidiPitchWindow = (
    notes: InlineMidiGeometryClip['midiNotes'],
    inline: boolean,
    contentHeight: number
): MidiPitchWindow => {
    let minPitch = notes.length === 0 ? MIDDLE_C : 127;
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
        minPitch -= 2;
        maxPitch += 2;
        if (maxPitch - minPitch < MIN_INLINE_PITCH_SPAN) {
            const center = Math.round((maxPitch + minPitch) / 2);
            minPitch = center - MIN_INLINE_PITCH_SPAN / 2;
            maxPitch = center + MIN_INLINE_PITCH_SPAN / 2;
        }
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
 * outside the note area; `pitch` is null on a row that is no MIDI pitch.
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
    const loopLen = clip.loopEnabled && clip.loopLength ? clip.loopLength : clipDuration;
    const loopBeat = loopLen > 0 && clip.loopEnabled ? clipBeat % loopLen : clipBeat;
    const noteBeat = loopBeat + (clip.midiOffsetBeats ?? 0);

    const depth = pointerY - frame.contentTop;
    if (depth < 0 || depth >= frame.contentHeight) {
        return { noteBeat, pitch: null };
    }
    const row = Math.min(Math.floor(depth / window.rowHeight), window.pitchRange);
    const pitch = window.maxPitch - row;
    if (pitch < 0 || pitch > MAX_MIDI_PITCH) {
        return { noteBeat, pitch: null };
    }
    return { noteBeat, pitch };
};
