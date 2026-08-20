/**
 * Constants and types for the PianoRoll editor.
 * Shared between the main view, renderer, gestures hook, and sub-components.
 */

import { SCALE_PATTERNS, KEY_NAMES } from '#/utils/Music/MusicalScale';

import { type MidiNote } from '../../models/MidiNoteViewTypes';

export { NOTE_NAMES } from '#/utils/noteNames';

/**
 * Stable empty array for clips with no notes yet. `useStoreSelector`'s
 * default equality is `Object.is`, so a fresh `[]` literal returned from a
 * selector's `?? []` fallback would look like a new value on every store
 * notification — forcing a re-render (and, in the renderer's dirty check, a
 * full repaint) even when nothing about the focused clip changed. Reusing
 * this constant keeps the reference stable across notifications.
 */
export const EMPTY_NOTES: MidiNote[] = [];
export const SCALES = SCALE_PATTERNS;
export const SCALE_ROOT_LABELS = KEY_NAMES;
export const TOTAL_ROWS = 60;
export const BASE_PITCH = 24;
export const ROW_HEIGHT = 16;
/** Minimum grid span, in beats, so an empty or very short clip still opens on a usable grid. */
export const GRID_BEATS = 32;
export const RULER_HEIGHT = 22;

/**
 * Bar length used to round the grid extent, matching the ruler and grid's
 * existing 4/4 assumption (`beat % 4 === 0` in `usePianoRollRenderer`'s bar
 * markers). The piano roll does not yet read the project's actual time
 * signature anywhere else, so this mirrors what the grid already draws
 * rather than introducing a second, inconsistent notion of "a bar".
 */
const EXTENT_BEATS_PER_BAR = 4;

/**
 * Bars of scratch room appended past the last bar of real content. Every
 * established DAW (Ableton, Logic, FL Studio, Cubase) lets you draw or drag a
 * note somewhat past the clip's end without first resizing the clip — the
 * editor never stops exactly at the boundary.
 */
const TRAILING_BARS = 1;

/**
 * Beats the piano roll's scrollable canvas must span.
 *
 * Sized from the material being edited, not a fixed constant: takes the
 * larger of the clip's own length and the end of its furthest note
 * (`startBeat + duration`), floors it at `GRID_BEATS` so an empty or very
 * short clip still opens on a usable grid, rounds up to a whole bar, then
 * appends `TRAILING_BARS` of room past that boundary so the user can draw or
 * drag past the end.
 *
 * This is the single source of truth for the grid's beat span — both
 * `PianoRoll.tsx` (scroll container + expression-lane width) and
 * `usePianoRollRenderer.ts` (canvas backing store + grid cache) must call
 * this instead of recomputing the rule themselves. Two independent copies of
 * this formula is how a MIDI clip longer than eight bars ends up with its
 * tail undrawn, unscrollable, and unselectable again.
 */
export const getPianoRollExtentBeats = (clipLengthBeats: number, notes: readonly MidiNote[]): number => {
    let furthestNoteEndBeat = 0;
    for (const note of notes) {
        const endBeat = note.startBeat + note.duration;
        if (endBeat > furthestNoteEndBeat) {
            furthestNoteEndBeat = endBeat;
        }
    }
    const contentBeats = Math.max(clipLengthBeats, furthestNoteEndBeat, GRID_BEATS);
    const barBeats = Math.ceil(contentBeats / EXTENT_BEATS_PER_BAR) * EXTENT_BEATS_PER_BAR;
    return barBeats + TRAILING_BARS * EXTENT_BEATS_PER_BAR;
};

export type DragMode =
    'none' | 'move' | 'duplicate' | 'resize-left' | 'resize-right' | 'draw' | 'rubber-band' | 'paint' | 'lasso';

export type DragState = {
    mode: DragMode;
    noteId: string | null;
    /** A9: which clip owns the dragged note (for multi-clip editing). Defaults to primary clipId. */
    ownerClipId?: string;
    startX: number;
    startY: number;
    origBeat: number;
    origPitch: number;
    origDuration: number;
    _prevDeltaBeat: number;
    _prevDeltaPitch: number;
};

export type PianoRollMenu = { x: number; y: number; beat: number } | null;

export const INITIAL_DRAG_STATE: DragState = {
    mode: 'none',
    noteId: null,
    startX: 0,
    startY: 0,
    origBeat: 0,
    origPitch: 0,
    origDuration: 1,
    _prevDeltaBeat: 0,
    _prevDeltaPitch: 0,
};

/** Compute visible pitches based on scale filter and folding. */
export const getVisiblePitches = (scaleType: string, scaleRoot: number, isFolded: boolean): number[] => {
    const scaleIntervals = SCALE_PATTERNS[scaleType] ?? SCALE_PATTERNS.chromatic!;
    const pitches: number[] = [];
    for (let pitch = BASE_PITCH + TOTAL_ROWS - 1; pitch >= BASE_PITCH; pitch--) {
        const relativeNote = ((pitch % 12) - scaleRoot + 12) % 12;
        if (!isFolded || scaleIntervals.includes(relativeNote)) {
            pitches.push(pitch);
        }
    }
    return pitches;
};

/** Inject an alpha value into an oklch() color string. */
export const colorWithAlpha = (color: string, alpha: number): string => {
    const match = color.match(/oklch\(([^)]+)\)/);
    if (match) {
        const base = match[1]!.replace(/\s*\/\s*[\d.]+\s*$/, '').trim();
        return `oklch(${base} / ${alpha})`;
    }
    return color;
};

/** Return a brighter version of an oklch color (for selected notes). */
export const brightenColor = (color: string, amount: number = 0.18): string => {
    const match = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (match) {
        const length = Math.min(1, parseFloat(match[1]!) + amount);
        const context = parseFloat(match[2]!);
        const h = parseFloat(match[3]!);
        return `oklch(${length.toFixed(3)} ${context} ${h})`;
    }
    return color;
};
