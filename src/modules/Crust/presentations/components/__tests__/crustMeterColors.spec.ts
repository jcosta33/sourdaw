import { describe, it, expect } from 'vitest';

import { grColor, grTextColor } from '../crustMeterColors';

describe('grColor', () => {
    it('returns the neutral colour at and below 1 dB of gain reduction', () => {
        expect(grColor(0)).toBe('#E8E6E0');
        expect(grColor(1)).toBe('#E8E6E0');
        expect(grColor(-1)).toBe('#E8E6E0');
    });

    it('returns the amber colour between 1 and 4 dB', () => {
        expect(grColor(1.5)).toBe('#D4A847');
        expect(grColor(4)).toBe('#D4A847');
        expect(grColor(-4)).toBe('#D4A847');
    });

    it('returns the orange colour between 4 and 8 dB', () => {
        expect(grColor(4.5)).toBe('#C87C2A');
        expect(grColor(8)).toBe('#C87C2A');
        expect(grColor(-8)).toBe('#C87C2A');
    });

    it('returns the red colour above 8 dB', () => {
        expect(grColor(8.1)).toBe('#C44030');
        expect(grColor(20)).toBe('#C44030');
        expect(grColor(-20)).toBe('#C44030');
    });
});

describe('grTextColor', () => {
    it('uses semantic text and state roles without changing the canvas meter palette', () => {
        expect(grTextColor(0)).toBe('var(--color-text-primary)');
        expect(grTextColor(-1)).toBe('var(--color-text-primary)');
        expect(grTextColor(-1.5)).toBe('var(--color-state-warning)');
        expect(grTextColor(-4)).toBe('var(--color-state-warning)');
        expect(grTextColor(-4.5)).toBe('var(--color-accent-orange)');
        expect(grTextColor(-8)).toBe('var(--color-accent-orange)');
        expect(grTextColor(-8.1)).toBe('var(--color-state-danger)');
        expect(grTextColor(-20)).toBe('var(--color-state-danger)');
    });
});
