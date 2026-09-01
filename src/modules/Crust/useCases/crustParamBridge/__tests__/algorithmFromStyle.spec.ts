import { describe, it, expect } from 'vitest';

import { algorithmFromStyle } from '../algorithmFromStyle';

describe('algorithmFromStyle', () => {
    // Same three pairs as Algorithm::from_style_index in crates/daw-dsp/src/crust/params.rs.
    it.each([
        ['transparent', 'transparent'],
        ['punchy', 'punchy'],
        ['loud', 'wall'],
    ] as const)('should map style %s to algorithm %s', (style, algorithm) => {
        expect(algorithmFromStyle(style)).toBe(algorithm);
    });

    it('should return null for an unknown style', () => {
        expect(algorithmFromStyle('brutal')).toBeNull();
    });
});
