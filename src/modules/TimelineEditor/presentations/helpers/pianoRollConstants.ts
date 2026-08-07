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
export const GRID_BEATS = 32;
export const RULER_HEIGHT = 22;

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
