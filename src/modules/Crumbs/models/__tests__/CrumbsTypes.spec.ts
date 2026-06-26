import { describe, it, expect } from 'vitest';

import { createDefaultPad, midiNoteToName, PAD_COLORS, DEFAULT_PAD_COLOR } from '../CrumbsTypes';

describe('midiNoteToName', () => {
    it('names a standard MIDI note', () => {
        // 60 = middle C (C4) under the C-1-origin octave convention used here.
        expect(midiNoteToName(60)).toBe('C4');
    });

    it('degrades to a visible placeholder on a non-finite note instead of asserting', () => {
        // names[NaN % 12] is undefined; the old `!` asserted it as a string and
        // produced "undefined-1" rather than a recognizable degradation.
        expect(midiNoteToName(Number.NaN)).toBe('?NaN');
    });
});

describe('createDefaultPad', () => {
    it('assigns the palette color for an in-range index', () => {
        expect(createDefaultPad(0).color).toBe(PAD_COLORS[0]);
    });

    it('wraps the palette by modulo so every index gets a defined color', () => {
        // index === PAD_COLORS.length wraps to PAD_COLORS[0]; the fallback only
        // engages for a genuinely undefined lookup.
        const pad = createDefaultPad(PAD_COLORS.length);
        expect(pad.color).toBe(PAD_COLORS[0]);
        expect(pad.color).not.toBeUndefined();
    });

    it('falls back to the default color rather than undefined for any index', () => {
        const pad = createDefaultPad(123);
        expect(typeof pad.color).toBe('string');
        expect(pad.color.length).toBeGreaterThan(0);
        // DEFAULT_PAD_COLOR is the floor the `?? ` provides.
        expect([...PAD_COLORS, DEFAULT_PAD_COLOR]).toContain(pad.color);
    });
});
