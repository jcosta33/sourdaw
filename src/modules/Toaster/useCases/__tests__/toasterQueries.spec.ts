import { describe, it, expect } from 'vitest';
import { getToasterPresets, DEFAULT_PAD_NAMES, TOASTER_PRESETS } from '../toasterQueries';

describe('toasterQueries', () => {
    it('exposes 16 default pad names', () => {
        expect(DEFAULT_PAD_NAMES).toHaveLength(16);
    });

    it('exposes the toaster preset list via getter and constant', () => {
        expect(getToasterPresets()).toBe(TOASTER_PRESETS);
        expect(Array.isArray(TOASTER_PRESETS)).toBe(true);
    });
});
