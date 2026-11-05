import { describe, expect, it } from 'vitest';

import { getVisiblePitches } from '../pianoRollConstants';
import { getPianoRollOpeningScroll } from '../pianoRollOpeningScroll';

// Geometry restated from the roll's law: ruler 22px, then 16px per row, row 0
// = pitch 127 (G9), 128 rows, so content is 22 + 128 * 16 = 2070px tall.
const chromatic = getVisiblePitches('chromatic', 0, false);
const note = (pitch: number, startBeat = 0): { pitch: number; startBeat: number } => ({ pitch, startBeat });

const open = (
    overrides: Partial<Parameters<typeof getPianoRollOpeningScroll>[0]>
): ReturnType<typeof getPianoRollOpeningScroll> =>
    getPianoRollOpeningScroll({
        notes: [],
        visiblePitches: chromatic,
        viewportHeight: 300,
        viewportWidth: 800,
        scrollLeft: 0,
        beatWidth: 40,
        ...overrides,
    });

describe('getPianoRollOpeningScroll vertical', () => {
    it.each([
        // C3 (48) is row 79, E3 (52) is row 75: span 1222..1302, centre 1262, minus (300 + 22) / 2.
        ['notes C3..E3 are centred below the ruler', [note(48), note(52)], 300, 1262 - 161],
        // Span 80px does not fit the 78px area under the ruler: highest note (top 1222) sits under the ruler.
        ['a span taller than the viewport anchors the highest note', [note(48), note(52)], 100, 1222 - 22],
        ['an empty clip is centred on middle C (row 67, centre 1102)', [], 300, 1102 - 161],
        ['the top of the range clamps to 0', [note(127)], 300, 0],
        ['the bottom of the range clamps to content height minus viewport', [note(0)], 300, 2070 - 300],
    ])('%s', (_name, notes, viewportHeight, expected) => {
        expect(open({ notes, viewportHeight })?.scrollTop).toBe(expected);
    });

    it('uses folded rows and ignores notes whose pitch has no row', () => {
        const folded = getVisiblePitches('major', 0, true);
        const rowOf = (pitch: number): number => folded.indexOf(pitch);
        const top = 22 + rowOf(52) * 16;
        const bottom = 22 + rowOf(48) * 16 + 16;
        const result = open({ visiblePitches: folded, notes: [note(48), note(52), note(49, 500)] });
        expect(result?.scrollTop).toBe((top + bottom) / 2 - 161);
        expect(result?.scrollLeft).toBeNull();
    });

    it('centres an empty folded clip on the nearest row to middle C', () => {
        const folded = getVisiblePitches('major', 2, true); // D major: C# but no C natural
        const row = folded.indexOf(61);
        expect(folded.includes(60)).toBe(false);
        expect(open({ visiblePitches: folded })?.scrollTop).toBe(22 + row * 16 + 8 - 161);
    });
});

describe('getPianoRollOpeningScroll horizontal', () => {
    it('scrolls to an earliest note beyond the viewport, just right of the rail', () => {
        // Beat 100 at 40px per beat = 4000px, less the 8px margin.
        expect(open({ notes: [note(48, 100), note(52, 120)] })?.scrollLeft).toBe(3992);
    });

    it('leaves scrollLeft alone when the earliest note is in view', () => {
        expect(open({ notes: [note(48, 2)] })?.scrollLeft).toBeNull();
    });

    it('scrolls back to a note left of the current scroll', () => {
        expect(open({ notes: [note(48, 1)], scrollLeft: 500 })?.scrollLeft).toBe(32);
    });
});

describe('getPianoRollOpeningScroll without a viewport', () => {
    it.each([
        ['zero height', { viewportHeight: 0 }],
        ['zero width', { viewportWidth: 0 }],
        ['NaN height', { viewportHeight: Number.NaN }],
    ])('returns null for %s', (_name, overrides) => {
        expect(open({ notes: [note(48)], ...overrides })).toBeNull();
    });
});
