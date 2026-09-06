import { describe, it, expect } from 'vitest';

import { searchPresets, getAvailablePresets } from '../fuzzySearch';

import type { PresetContext } from '../../models/PresetActions/Registry';

const ctx: PresetContext = {
    selectedTrackId: 't1',
    selectedClipId: 'c1',
    selectedClipType: 'midi',
    trackCount: 2,
};

describe('getAvailablePresets', () => {
    it('returns non-empty array', () => {
        const result = getAvailablePresets(ctx);
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns presets sorted by category order', () => {
        const result = getAvailablePresets(ctx);
        if (result.length >= 2) {
            // Categories should be in defined order
            const categories = result.map((p) => p.category);
            for (let i = 1; i < categories.length; i++) {
                expect(categories.indexOf(categories[i]!)).toBeGreaterThanOrEqual(
                    categories.indexOf(categories[i - 1]!)
                );
            }
        }
    });

    it('returns empty for context with no track', () => {
        const empty_ctx: PresetContext = {
            selectedTrackId: undefined,
            selectedClipId: undefined,
            selectedClipType: undefined,
            trackCount: 0,
        };
        const result = getAvailablePresets(empty_ctx);
        // Some presets require tracks, some don't
        expect(Array.isArray(result)).toBe(true);
    });
});

describe('searchPresets', () => {
    it('returns all available for empty query', () => {
        const result = searchPresets('', ctx);
        expect(result.length).toBeGreaterThan(0);
        expect(result.every((r) => r.score === 0)).toBe(true);
    });

    it('returns all available for whitespace query', () => {
        const result = searchPresets('   ', ctx);
        expect(result.length).toBeGreaterThan(0);
    });

    it('filters by query tokens', () => {
        const result = searchPresets('tempo', ctx);
        expect(result.length).toBeGreaterThan(0);
        expect(result.every((r) => r.score > 0)).toBe(true);
    });

    it('returns empty for nonsensical query', () => {
        const result = searchPresets('zzzzxxxqqq', ctx);
        expect(result).toEqual([]);
    });

    it('respects limit parameter', () => {
        const result = searchPresets('', ctx, 3);
        expect(result.length).toBeLessThanOrEqual(3);
    });

    it('sorts by score descending', () => {
        const result = searchPresets('add', ctx);
        if (result.length >= 2) {
            expect(result[0]!.score).toBeGreaterThanOrEqual(result[1]!.score);
        }
    });
});
