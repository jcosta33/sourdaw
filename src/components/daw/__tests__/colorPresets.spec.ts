import { describe, it, expect } from 'vitest';

import { CLIP_COLOR_PRESETS, TRACK_COLOR_PRESETS } from '../colorPresets';

describe('colorPresets', () => {
    it('should export TRACK_COLOR_PRESETS as 12 oklch strings', () => {
        expect(TRACK_COLOR_PRESETS).toHaveLength(12);
        for (const context of TRACK_COLOR_PRESETS) {
            expect(context).toMatch(/^oklch\(/);
        }
    });

    it('should export CLIP_COLOR_PRESETS as 8 oklch strings', () => {
        expect(CLIP_COLOR_PRESETS).toHaveLength(8);
        for (const context of CLIP_COLOR_PRESETS) {
            expect(context).toMatch(/^oklch\(/);
        }
    });

    it('should align clip presets with the first track palette entries', () => {
        expect(TRACK_COLOR_PRESETS.slice(0, CLIP_COLOR_PRESETS.length)).toEqual(CLIP_COLOR_PRESETS);
    });
});
