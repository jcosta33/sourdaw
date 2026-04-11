import { describe, it, expect } from 'vitest';
import { getFermenterPresets, FERMENTER_PRESETS, FERMENTER_PARAMS } from './fermenterQueries';

describe('fermenterQueries', () => {
    it('exposes a non-empty preset list via getter and constant', () => {
        expect(getFermenterPresets().length).toBeGreaterThan(0);
        expect(FERMENTER_PRESETS).toBe(getFermenterPresets());
    });

    it('exposes parameter definitions with min/max/default', () => {
        expect(FERMENTER_PARAMS.length).toBeGreaterThan(0);
        for (const param of FERMENTER_PARAMS) {
            expect(typeof param.id).toBe('string');
            expect(typeof param.min).toBe('number');
            expect(typeof param.max).toBe('number');
            expect(typeof param.default).toBe('number');
            expect(param.min).toBeLessThanOrEqual(param.default);
            expect(param.default).toBeLessThanOrEqual(param.max);
        }
    });
});
