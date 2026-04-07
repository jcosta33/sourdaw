import { describe, it, expect } from 'vitest';
import { CLIP_COLOR_PRESETS, TRACK_COLOR_PRESETS } from './colorPresets';

describe('colorPresets', () => {
    it('should expose non-empty oklch preset arrays', () => {
        expect(TRACK_COLOR_PRESETS.length).toBeGreaterThan(0);
        expect(CLIP_COLOR_PRESETS.length).toBeGreaterThan(0);
        expect(TRACK_COLOR_PRESETS.every((c) => c.startsWith('oklch('))).toBe(true);
        expect(CLIP_COLOR_PRESETS.every((c) => c.startsWith('oklch('))).toBe(true);
    });
});
