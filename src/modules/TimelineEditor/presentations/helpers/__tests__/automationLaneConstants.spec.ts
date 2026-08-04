import { describe, it, expect } from 'vitest';

import { formatParameterValue, curveLabel } from '../automationLaneConstants';

describe('formatParameterValue — gain', () => {
    it('returns "-∞ dB" for value <= 0', () => {
        expect(formatParameterValue(0, 'gain')).toBe('-∞ dB');
        expect(formatParameterValue(-1, 'gain')).toBe('-∞ dB');
    });

    it('returns dB value for positive gain', () => {
        // 20 * log10(0.5) ≈ -6.0206 → "-6.0 dB"
        expect(formatParameterValue(0.5, 'gain')).toBe('-6.0 dB');
    });

    it('returns "0.0 dB" for unity gain (1.0)', () => {
        expect(formatParameterValue(1, 'gain')).toBe('0.0 dB');
    });

    it('returns positive dB for gain > 1', () => {
        // 20 * log10(2) ≈ 6.0206 → "6.0 dB"
        expect(formatParameterValue(2, 'gain')).toBe('6.0 dB');
    });
});

describe('formatParameterValue — pan', () => {
    it('returns "C" for center (|value| < 0.01)', () => {
        expect(formatParameterValue(0, 'pan')).toBe('C');
        expect(formatParameterValue(0.009, 'pan')).toBe('C');
        expect(formatParameterValue(-0.009, 'pan')).toBe('C');
    });

    it('returns "{N}R" for positive pan (right)', () => {
        expect(formatParameterValue(0.5, 'pan')).toBe('50R');
        expect(formatParameterValue(1, 'pan')).toBe('100R');
    });

    it('returns "{N}L" for negative pan (left)', () => {
        expect(formatParameterValue(-0.25, 'pan')).toBe('25L');
        expect(formatParameterValue(-1, 'pan')).toBe('100L');
    });
});

describe('formatParameterValue — default (percentage)', () => {
    it('returns percentage for non-gain/pan params', () => {
        expect(formatParameterValue(0.5, 'mix')).toBe('50%');
        expect(formatParameterValue(1, 'volume')).toBe('100%');
        expect(formatParameterValue(0, 'reverb')).toBe('0%');
    });
});

describe('curveLabel', () => {
    it('returns "S" for s-curve', () => {
        expect(curveLabel('s-curve')).toBe('S');
    });

    it('returns "E" for exponential', () => {
        expect(curveLabel('exponential')).toBe('E');
    });

    it('returns "⌐" for step', () => {
        expect(curveLabel('step')).toBe('⌐');
    });

    it('returns "⊏" for stairs', () => {
        expect(curveLabel('stairs')).toBe('⊏');
    });

    it('returns "~" for smooth', () => {
        expect(curveLabel('smooth')).toBe('~');
    });

    it('returns empty string for linear', () => {
        expect(curveLabel('linear')).toBe('');
    });

    it('returns empty string for bezier', () => {
        expect(curveLabel('bezier')).toBe('');
    });
});
