import { describe, expect, it } from 'vitest';

import { normalizeUiScale as normalizePreferenceModelUiScale } from '../../models/Preferences';
import { normalizeUiScale } from '../normalizeUiScale';

describe('normalizeUiScale', () => {
    it('owns the public callable boundary instead of exposing the private model function', () => {
        expect(normalizeUiScale).not.toBe(normalizePreferenceModelUiScale);
    });

    it.each([0.5, 1, 1.25, 2])('preserves supported UI scale %s', (scale) => {
        expect(normalizeUiScale(scale)).toBe(scale);
    });

    it.each([0, -1, 2.01, Number.NaN, Number.POSITIVE_INFINITY])('defaults unsupported UI scale %s', (scale) => {
        expect(normalizeUiScale(scale)).toBe(1);
    });
});
