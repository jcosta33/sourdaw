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
 * Width of the sticky piano-key rail down the left edge of the editor.
 *
 * Three things must agree on this number or the grid lands in the wrong
 * place: the rail's own box, the `left` offset the sticky canvas pins itself
 * at (`PianoRoll.tsx`), and the viewport width the renderer derives from the
 * scroll container's `clientWidth` (`usePianoRollRenderer.ts`). The canvas is
 * viewport-sized rather than content-sized, so that subtraction is what tells
 * it how much of the arrangement it is actually drawing.
 */
export const PITCH_RAIL_WIDTH = 40;

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
 * One clip's contribution to the piano roll's shared beat extent: its own
 * length and the notes drawn in its coordinate space.
 */
export type PianoRollExtentSource = {
    clipLengthBeats: number;
    notes: readonly MidiNote[];
};

/**
 * Beats the piano roll's scrollable *layout* must span.
 *
 * Sized from the material actually drawn, not a fixed constant: takes the
 * largest clip length and the furthest note end (`startBeat + duration`)
 * across every `source` — the primary clip being edited *and* every clip
 * opened alongside it (`deps.openedClipIds`, wired from `ClipView.tsx`'s
 * multi-clip selection). Those opened clips' notes are drawn in the same
 * absolute beat coordinate space by `drawOpenedClipNotes` and are editable,
 * not read-only ghosts — an extent computed from the primary clip alone
 * reproduces the exact "tail outside the canvas" bug this helper exists to
 * fix, just through a second clip instead of a long first one.
 *
 * The result floors at `GRID_BEATS` so an empty or very short clip still
 * opens on a usable grid, rounds up to a whole bar, then appends
 * `TRAILING_BARS` of room past that boundary so the user can draw or drag
 * past the end.
 *
 * **There is deliberately no pixel ceiling here, and adding one is a
 * regression.** This value drives CSS layout only — the scroll container's
 * width and the expression lane's content width — and CSS layout has no
 * canvas-dimension limit to bound against. The `<canvas>` backing store is
 * sized from the *viewport*, not from this extent (see
 * `usePianoRollRenderer.ts`), and is drawn translated by the scroll offset.
 * That decoupling is the whole point: while one backing store had to span
 * the entire arrangement, reachable beats were inversely proportional to
 * zoom by construction, so any budget on that product could only pick which
 * of the two to sacrifice — a fixed beat cap truncated long clips at every
 * zoom, and a pixel budget converted to beats truncated a routine 64-bar
 * clip at ordinary zoom on an ordinary HiDPI display. Reachability must not
 * depend on zoom at all, and with a viewport-sized backing store it does not.
 *
 * A non-finite `clipLengthBeats` (nothing validates clip `startBeat`/`endBeat`
 * upstream) is treated as `0` rather than passed to `Math.max` — an `Infinity`
 * or `NaN` operand there poisons the whole result to `NaN`, which coerces
 * every downstream width to `0` and silently blanks the piano roll instead of
 * falling back to the `GRID_BEATS` floor. A non-finite note
 * `startBeat`/`duration` is already excluded by the comparison in the notes
 * loop below (`endBeat > furthestNoteEndBeat` is `false` for `NaN`), so it
 * needs no separate guard.
 *
 * `PianoRoll.tsx` is the only caller: it owns layout, and layout is the only
 * thing this measures. The renderer must not call it — a second copy of this
 * rule, fed a different source list, is how a MIDI clip (or an opened one
 * alongside it) ended up with its tail undrawn and unselectable before.
 */
export const getPianoRollExtentBeats = (sources: readonly PianoRollExtentSource[]): number => {
    let maxClipLengthBeats = 0;
    let furthestNoteEndBeat = 0;
    for (const source of sources) {
        // A non-finite clipLengthBeats (nothing upstream validates a clip's
        // startBeat/endBeat) must not reach Math.max below: Math.max(x, NaN)
        // is NaN regardless of x, which would poison the whole extent.
        const clipLengthBeats = Number.isFinite(source.clipLengthBeats) ? source.clipLengthBeats : 0;
        maxClipLengthBeats = Math.max(maxClipLengthBeats, clipLengthBeats);
        for (const note of source.notes) {
            const endBeat = note.startBeat + note.duration;
            if (endBeat > furthestNoteEndBeat) {
                furthestNoteEndBeat = endBeat;
            }
        }
    }
    const contentBeats = Math.max(maxClipLengthBeats, furthestNoteEndBeat, GRID_BEATS);
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
