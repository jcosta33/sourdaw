import { describe, it, expect } from 'vitest';

import { getToasterPresets, DEFAULT_PAD_NAMES, TOASTER_PRESETS } from '../toasterQueries';

describe('toasterQueries', () => {
    it('exposes 16 default pad names', () => {
        expect(DEFAULT_PAD_NAMES).toHaveLength(16);
    });

    it('exposes the toaster preset list via getter and constant', () => {
        expect(Array.isArray(TOASTER_PRESETS)).toBe(true);
        expect(getToasterPresets()).toEqual(TOASTER_PRESETS);
    });

    it('returns a fresh array so callers cannot mutate the shared preset registry', () => {
        const first = getToasterPresets();
        const second = getToasterPresets();
        // Each call yields a distinct container...
        expect(first).not.toBe(TOASTER_PRESETS);
        expect(first).not.toBe(second);
        // ...so mutating the returned array leaves the source untouched.
        const originalLength = TOASTER_PRESETS.length;
        first.push(first[0]!);
        expect(TOASTER_PRESETS).toHaveLength(originalLength);
        expect(getToasterPresets()).toHaveLength(originalLength);
    });
});
