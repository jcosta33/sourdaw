import { describe, it, expect } from 'vitest';

import { CLIP_COLOR_OPTIONS, MARKER_COLOR_PRESETS, SECTION_COLORS, TRACK_COLOR_PALETTE } from '../ColorPalette';

const OKLCH_RE = /^oklch\(/;

describe('ColorPalette — structural integrity', () => {
    it('TRACK_COLOR_PALETTE has 12 colors, all in oklch format', () => {
        expect(TRACK_COLOR_PALETTE).toHaveLength(12);
        for (const color of TRACK_COLOR_PALETTE) {
            expect(color).toMatch(OKLCH_RE);
        }
    });

    it('SECTION_COLORS has 6 colors, all in oklch format', () => {
        expect(SECTION_COLORS).toHaveLength(6);
        for (const color of SECTION_COLORS) {
            expect(color).toMatch(OKLCH_RE);
        }
    });

    it('MARKER_COLOR_PRESETS is non-empty and all oklch', () => {
        expect(MARKER_COLOR_PRESETS.length).toBeGreaterThan(0);
        for (const color of MARKER_COLOR_PRESETS) {
            expect(color).toMatch(OKLCH_RE);
        }
    });

    it('CLIP_COLOR_OPTIONS first entry is the empty inherit sentinel', () => {
        expect(CLIP_COLOR_OPTIONS[0]).toBe('');
    });

    it('CLIP_COLOR_OPTIONS remaining entries are all oklch', () => {
        for (const color of CLIP_COLOR_OPTIONS.slice(1)) {
            expect(color).toMatch(OKLCH_RE);
        }
    });

    it('TRACK_COLOR_PALETTE has no duplicate colors', () => {
        expect(new Set(TRACK_COLOR_PALETTE).size).toBe(TRACK_COLOR_PALETTE.length);
    });

    it('SECTION_COLORS has no duplicate colors', () => {
        expect(new Set(SECTION_COLORS).size).toBe(SECTION_COLORS.length);
    });

    it('MARKER_COLOR_PRESETS has no duplicate colors', () => {
        expect(new Set(MARKER_COLOR_PRESETS).size).toBe(MARKER_COLOR_PRESETS.length);
    });

    it('CLIP_COLOR_OPTIONS has no duplicate colors (including the empty sentinel)', () => {
        expect(new Set(CLIP_COLOR_OPTIONS).size).toBe(CLIP_COLOR_OPTIONS.length);
    });
});
