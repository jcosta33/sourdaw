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
 * Pixel budget the extent ceiling bounds against — a canvas *dimension*
 * limit, not a beat limit. The piano roll's canvas is sized in device pixels
 * as `extentBeats * beatWidth * devicePixelRatio` (see
 * `usePianoRollRenderer.ts`, `canvas.width = Math.round(totalWidth * dpr)`),
 * so the safe number of *beats* is not one fixed constant — it depends on how
 * many pixels each beat currently occupies, i.e. on the caller's zoom level.
 *
 * Chromium's own measured hard limit for a single `<canvas>` dimension is
 * ~32,767px (2^15 - 1, hit through 32-bit backing-store math and GPU
 * texture-size limits) — see https://issues.chromium.org/issues/40349850 and
 * the cross-browser measurements at
 * https://github.com/jhildenbiddle/canvas-size. That figure is
 * browser-and-GPU-dependent, not a spec guarantee, so this bounds at 24,576px
 * (75% of it) rather than the measured limit itself: a quarter of headroom
 * for driver/platform variance (older or embedded GPUs, non-Chromium
 * WebViews) without being measurably restrictive at any zoom level a piano
 * roll user actually works at — see `getPianoRollExtentBeats`' per-call
 * derivation below.
 */
export const MAX_CANVAS_DIMENSION_PX = 24_576;

/**
 * Fallback pixels-per-beat used only if a caller passes a non-finite or
 * non-positive value — the worst realistic case (max zoom, `beatWidth` 160 at
 * 400% — see `usePianoRollInteractions.ts`'s zoom clamp and the toolbar's
 * zoom slider — times a common HiDPI `devicePixelRatio` of 2). An invalid
 * input then still gets the smallest (most protective) ceiling instead of an
 * unbounded one.
 */
const FALLBACK_PIXELS_PER_BEAT = 320;

/**
 * One clip's contribution to the piano roll's shared beat extent: its own
 * length and the notes drawn in its coordinate space.
 */
export type PianoRollExtentSource = {
    clipLengthBeats: number;
    notes: readonly MidiNote[];
};

/**
 * Beats the piano roll's scrollable canvas must span.
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
 * opens on a usable grid, clamps at a ceiling derived from `pixelsPerBeat`
 * (below) so a malformed `startBeat`/`endBeat` (or a legitimately huge one)
 * cannot drive the canvas backing store past what the browser can allocate,
 * rounds up to a whole bar, then appends `TRAILING_BARS` of room past that
 * boundary so the user can draw or drag past the end.
 *
 * `pixelsPerBeat` is the caller's current `beatWidth * devicePixelRatio` —
 * how many device pixels one beat actually occupies right now. The ceiling
 * is `floor(MAX_CANVAS_DIMENSION_PX / pixelsPerBeat)`: a *pixel* budget
 * converted to beats at the current zoom, not a fixed beat count computed
 * once at maximum zoom and applied everywhere. A fixed beat ceiling sized
 * for maximum zoom is itself the extent-cap bug this helper exists to fix,
 * just re-triggered by ordinary content instead of a fixed constant — a
 * 200-beat clip (50 bars at 4/4, an unremarkable arrangement) has its tail
 * clipped at every zoom level even though at anything but maximum zoom the
 * canvas has plenty of pixel budget left. Deriving the ceiling from the
 * current `pixelsPerBeat` means it only engages when the pixel math actually
 * demands it — a malformed import at any zoom, or ordinary long content only
 * once the user zooms in far enough that it would matter anyway.
 *
 * A non-finite `clipLengthBeats` (nothing validates clip `startBeat`/`endBeat`
 * upstream) is treated as `0` rather than passed to `Math.max` — an `Infinity`
 * or `NaN` operand there poisons the whole result to `NaN`, which coerces
 * `canvas.width` to `0` and silently blanks the piano roll instead of falling
 * back to the `GRID_BEATS` floor. A non-finite note `startBeat`/`duration` is
 * already excluded by the comparison in the notes loop below (`endBeat >
 * furthestNoteEndBeat` is `false` for `NaN`), so it needs no separate guard.
 *
 * This is the single source of truth for the grid's beat span — both
 * `PianoRoll.tsx` (scroll container + expression-lane width) and
 * `usePianoRollRenderer.ts` (canvas backing store + grid cache) must call
 * this with the same source list *and* the same `pixelsPerBeat` (their own
 * `beatWidth * (window.devicePixelRatio || 1)`) instead of recomputing the
 * rule themselves. Two independent copies of this formula — different source
 * lists, or different `pixelsPerBeat` — is how a MIDI clip (or an opened one
 * alongside it) ends up with its tail undrawn, unscrollable, and
 * unselectable again.
 */
export const getPianoRollExtentBeats = (sources: readonly PianoRollExtentSource[], pixelsPerBeat: number): number => {
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
    const safePixelsPerBeat =
        Number.isFinite(pixelsPerBeat) && pixelsPerBeat > 0 ? pixelsPerBeat : FALLBACK_PIXELS_PER_BEAT;
    const maxContentBeats = Math.floor(MAX_CANVAS_DIMENSION_PX / safePixelsPerBeat);
    const contentBeats = Math.max(maxClipLengthBeats, furthestNoteEndBeat, GRID_BEATS);
    const clampedContentBeats = Math.min(contentBeats, maxContentBeats);
    const barBeats = Math.ceil(clampedContentBeats / EXTENT_BEATS_PER_BAR) * EXTENT_BEATS_PER_BAR;
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
