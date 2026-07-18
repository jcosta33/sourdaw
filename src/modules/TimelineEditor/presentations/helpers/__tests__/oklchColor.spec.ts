import { describe, it, expect } from 'vitest';

import { brightenColor, colorWithAlpha } from '../oklchColor';

describe('oklchColor', () => {
    describe('colorWithAlpha', () => {
        it('should inject alpha into an oklch color without existing alpha', () => {
            expect(colorWithAlpha('oklch(0.42 0.07 250)', 0.5)).toBe('oklch(0.42 0.07 250 / 0.5)');
        });

        it('should replace an existing trailing alpha segment', () => {
            expect(colorWithAlpha('oklch(0.42 0.07 250 / 0.8)', 0.25)).toBe('oklch(0.42 0.07 250 / 0.25)');
        });

        it('should return the input unchanged when not oklch', () => {
            expect(colorWithAlpha('#ff0000', 0.5)).toBe('#ff0000');
        });
    });

    describe('brightenColor', () => {
        it('should increase lightness up to a cap of 1', () => {
            expect(brightenColor('oklch(0.5 0.07 250)', 0.2)).toBe('oklch(0.700 0.07 250)');
        });

        it('should use default brighten amount when omitted', () => {
            expect(brightenColor('oklch(0.4 0.06 100)')).toBe('oklch(0.580 0.06 100)');
        });

        it('should return the input when the string is not oklch', () => {
            expect(brightenColor('rgb(1,0,0)')).toBe('rgb(1,0,0)');
        });
    });
});
