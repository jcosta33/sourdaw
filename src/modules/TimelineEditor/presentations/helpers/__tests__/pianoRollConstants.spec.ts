import { describe, it, expect } from 'vitest';

import { type MidiNote } from '../../../models/MidiNoteViewTypes';
import {
    getVisiblePitches,
    getPianoRollExtentBeats,
    GRID_BEATS,
    MAX_CANVAS_DIMENSION_PX,
    TOTAL_ROWS,
    BASE_PITCH,
    type PianoRollExtentSource,
} from '../pianoRollConstants';

const note = (startBeat: number, duration: number): MidiNote => ({
    id: `${startBeat}-${duration}`,
    pitch: 60,
    startBeat,
    duration,
    velocity: 100,
});

/**
 * `beatWidth` 40 at `devicePixelRatio` 1 — zoom 100% (the default) on a
 * standard-density desktop display. Ordinary enough that none of the
 * existing floor/rounding assertions below come anywhere near the ceiling.
 */
const ORDINARY_PIXELS_PER_BEAT = 40;

/** Single-source call, matching the shape most existing tests exercise. */
const extentOf = (
    clipLengthBeats: number,
    notes: readonly MidiNote[],
    pixelsPerBeat = ORDINARY_PIXELS_PER_BEAT
): number => getPianoRollExtentBeats([{ clipLengthBeats, notes }], pixelsPerBeat);

describe('getVisiblePitches — unfolded (all pitches)', () => {
    it('returns all 60 pitches descending from 83 to 24 when unfolded', () => {
        const pitches = getVisiblePitches('chromatic', 0, false);
        expect(pitches).toHaveLength(TOTAL_ROWS);
        expect(pitches[0]).toBe(BASE_PITCH + TOTAL_ROWS - 1); // 83
        expect(pitches[pitches.length - 1]).toBe(BASE_PITCH); // 24
    });

    it('returns all pitches even with a non-chromatic scale when unfolded', () => {
        const pitches = getVisiblePitches('major', 0, false);
        expect(pitches).toHaveLength(TOTAL_ROWS);
    });

    it('falls back to chromatic for an unknown scale type', () => {
        const pitches = getVisiblePitches('nonexistent', 0, false);
        expect(pitches).toHaveLength(TOTAL_ROWS);
    });
});

describe('getVisiblePitches — folded (scale-filtered)', () => {
    it('filters to only in-scale pitches when folded (C major)', () => {
        const pitches = getVisiblePitches('major', 0, true);
        // C major intervals: [0,2,4,5,7,9,11]. 7 out of 12 pitch classes per octave.
        // Over 60 rows (5 octaves): 5 * 7 = 35 pitches.
        expect(pitches).toHaveLength(35);
    });

    it('all folded pitches are in the C major scale', () => {
        const pitches = getVisiblePitches('major', 0, true);
        const majorIntervals = new Set([0, 2, 4, 5, 7, 9, 11]);
        for (const pitch of pitches) {
            const pc = pitch % 12;
            expect(majorIntervals.has(pc)).toBe(true);
        }
    });

    it('starts from the highest pitch (83) descending', () => {
        const pitches = getVisiblePitches('major', 0, true);
        // 83 % 12 = 11 → B, which is in C major (interval 11). So 83 is first.
        expect(pitches[0]).toBe(83);
    });

    it('respects scaleRoot offset (D major: root=2)', () => {
        const pitches = getVisiblePitches('major', 2, true);
        const majorIntervals = new Set([0, 2, 4, 5, 7, 9, 11]);
        for (const pitch of pitches) {
            const relativeNote = ((pitch % 12) - 2 + 12) % 12;
            expect(majorIntervals.has(relativeNote)).toBe(true);
        }
    });

    it('pentatonic folded has fewer pitches than major folded', () => {
        const majorPitches = getVisiblePitches('major', 0, true);
        const pentatonicPitches = getVisiblePitches('pentatonicMajor', 0, true);
        // Pentatonic has 5 intervals vs major's 7.
        expect(pentatonicPitches.length).toBeLessThan(majorPitches.length);
    });
});

describe('getPianoRollExtentBeats', () => {
    it('floors at GRID_BEATS, rounded to a bar, plus one trailing bar, for an empty clip', () => {
        // GRID_BEATS(32) is already a bar boundary → 32 + 4 trailing = 36.
        expect(extentOf(0, [])).toBe(GRID_BEATS + 4);
    });

    it('is unaffected by a clip shorter than the GRID_BEATS floor', () => {
        expect(extentOf(8, [])).toBe(GRID_BEATS + 4);
    });

    // Issue #2299: a clip longer than the floor must drive the extent, not
    // just be silently capped at GRID_BEATS.
    it('extends past GRID_BEATS to cover a clip longer than eight bars', () => {
        // clip length 40 → already a bar boundary → 40 + 4 trailing = 44.
        expect(extentOf(40, [])).toBe(44);
    });

    it('extends to cover a note ending past both the clip length and GRID_BEATS', () => {
        // furthest note end 38 (36+2) exceeds clip length 10 and GRID_BEATS(32)
        // → rounds up to bar 40, + 4 trailing = 44.
        expect(extentOf(10, [note(36, 2)])).toBe(44);
    });

    it('takes the furthest note across multiple notes, not the last one in the array', () => {
        expect(extentOf(0, [note(20, 1), note(2, 2), note(10, 1)])).toBe(extentOf(0, [note(20, 1)]));
    });

    it('rounds a non-bar-aligned content length up to the next bar before adding trailing room', () => {
        // clip length 34 is not a multiple of 4 → rounds up to bar 36, + 4 trailing = 40.
        expect(extentOf(34, [])).toBe(40);
    });

    // Gap: an opened clip (A9 multi-clip editing) is drawn in the same
    // absolute beat coordinate space as the primary clip and is editable,
    // not a read-only ghost — its content must grow the shared extent too,
    // or its tail reproduces the exact "drawn past the canvas" bug this
    // helper exists to fix, just through a second clip.
    it('folds a second source (an opened clip) into the shared extent', () => {
        const sources: PianoRollExtentSource[] = [
            { clipLengthBeats: 8, notes: [] },
            { clipLengthBeats: 0, notes: [note(50, 2)] },
        ];
        // furthest end across sources: 52 → bar 52, + 4 trailing = 56.
        expect(getPianoRollExtentBeats(sources, ORDINARY_PIXELS_PER_BEAT)).toBe(56);
    });

    it('takes the longer clip length across multiple sources, not just the first', () => {
        const sources: PianoRollExtentSource[] = [
            { clipLengthBeats: 8, notes: [] },
            { clipLengthBeats: 48, notes: [] },
        ];
        expect(getPianoRollExtentBeats(sources, ORDINARY_PIXELS_PER_BEAT)).toBe(extentOf(48, []));
    });

    // Gap: nothing upstream validates a clip's startBeat/endBeat, so a
    // non-finite clipLengthBeats must degrade to the GRID_BEATS floor rather
    // than poisoning the whole result via Math.max(NaN, ...) === NaN, which
    // downstream coerces canvas.width to 0 and blanks the piano roll.
    it('falls back to the GRID_BEATS floor when clipLengthBeats is NaN', () => {
        expect(extentOf(NaN, [])).toBe(GRID_BEATS + 4);
    });

    it('falls back to the GRID_BEATS floor when clipLengthBeats is Infinity', () => {
        expect(extentOf(Infinity, [])).toBe(GRID_BEATS + 4);
    });

    it('a non-finite source does not suppress a legitimate length from another source', () => {
        const sources: PianoRollExtentSource[] = [
            { clipLengthBeats: NaN, notes: [] },
            { clipLengthBeats: 48, notes: [] },
        ];
        expect(getPianoRollExtentBeats(sources, ORDINARY_PIXELS_PER_BEAT)).toBe(extentOf(48, []));
    });

    // Gap: a malformed import (or a genuinely huge startBeat + duration) must
    // not drive the canvas backing store past what the browser can allocate.
    // The ceiling is a *pixel* budget (MAX_CANVAS_DIMENSION_PX), converted to
    // beats at the caller's current pixelsPerBeat — see getPianoRollExtentBeats'
    // own doc comment for why a fixed beat ceiling would itself be a bug.
    it('clamps an absurd note end beat to a ceiling derived from the pixel budget, not growing unbounded', () => {
        const absurd = extentOf(0, [note(1_000_000, 1)]);
        const maxContentBeats = Math.floor(MAX_CANVAS_DIMENSION_PX / ORDINARY_PIXELS_PER_BEAT);
        const barAlignedMax = Math.ceil(maxContentBeats / 4) * 4 + 4;
        expect(absurd).toBe(barAlignedMax);
        expect(absurd).toBeLessThan(1_000_000);
    });

    it('clamps an absurd clip length the same way as an absurd note end beat', () => {
        expect(extentOf(1_000_000, [])).toBe(extentOf(0, [note(1_000_000, 1)]));
    });

    // The decisive case: an ordinary long clip, at an ordinary zoom, must
    // remain fully reachable. A fixed beat ceiling sized for maximum zoom
    // (the round-1 bug) would clip this at 64 beats regardless of zoom —
    // asserting against the clip's own length, not a hardcoded number, keeps
    // this test meaningful if the ceiling constant moves again.
    it('keeps a clip of a few hundred beats fully reachable at an ordinary zoom', () => {
        const clipLengthBeats = 200; // 50 bars at 4/4 — an unremarkable arrangement.
        const extent = extentOf(clipLengthBeats, []);
        expect(extent).toBeGreaterThanOrEqual(clipLengthBeats);
    });

    // Directly rebuts the round-1 defect: the ceiling must track the
    // caller's current zoom, not one constant applied everywhere. A small
    // pixelsPerBeat (zoomed out) must permit far more beats than a large one
    // (zoomed in) before the ceiling engages.
    it('derives a looser ceiling when zoomed out (smaller pixelsPerBeat) than when zoomed in', () => {
        const zoomedOutCeiling = Math.floor(MAX_CANVAS_DIMENSION_PX / 10); // beatWidth 10 — minimum zoom.
        const zoomedInCeiling = Math.floor(MAX_CANVAS_DIMENSION_PX / 320); // beatWidth 160 * dpr 2 — maximum zoom, HiDPI.
        expect(zoomedOutCeiling).toBeGreaterThan(zoomedInCeiling);

        const hugeClip = 10_000;
        const zoomedOutExtent = extentOf(hugeClip, [], 10);
        const zoomedInExtent = extentOf(hugeClip, [], 320);
        // Zoomed out, the pixel budget covers far more of the huge clip's
        // beats than zoomed in — proving the clamp genuinely varies with zoom
        // rather than capping at one fixed beat count everywhere.
        expect(zoomedOutExtent).toBeGreaterThan(zoomedInExtent);
    });

    // Defensive fallback: an invalid pixelsPerBeat (should never happen —
    // both call sites always pass a positive finite beatWidth * dpr) must not
    // disable the ceiling outright; it degrades to the most protective case.
    it('falls back to the most protective ceiling when pixelsPerBeat is invalid', () => {
        const withNaNPixelsPerBeat = getPianoRollExtentBeats(
            [{ clipLengthBeats: 0, notes: [note(1_000_000, 1)] }],
            NaN
        );
        const withZeroPixelsPerBeat = getPianoRollExtentBeats([{ clipLengthBeats: 0, notes: [note(1_000_000, 1)] }], 0);
        expect(withNaNPixelsPerBeat).toBeLessThan(1_000_000);
        expect(withZeroPixelsPerBeat).toBeLessThan(1_000_000);
    });
});
