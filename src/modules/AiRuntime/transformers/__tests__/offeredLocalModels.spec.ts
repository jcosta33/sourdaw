import { describe, expect, it } from 'vitest';

import { chooseOfferedModel, offeredLocalModels } from '../offeredLocalModels';

import type { LocalModelTier } from '../../models/ModelInfo';

type Model = { id: string; tier: LocalModelTier; memoryGb: number };

// Deliberately unsorted, so neither order of listing nor of the input decides the answer.
const models: Model[] = [
    { id: 'pro', tier: 'pro', memoryGb: 10.3 },
    { id: 'large', tier: 'large', memoryGb: 40 },
    { id: 'light', tier: 'light', memoryGb: 2.7 },
    { id: 'standard', tier: 'standard', memoryGb: 4.3 },
];
const ids = (offered: readonly Model[]): string[] => offered.map((model) => model.id).sort();

describe('offeredLocalModels', () => {
    it.each([
        { totalBytes: 40_000_000_000, expected: ['large', 'light', 'pro', 'standard'] },
        { totalBytes: 39_999_999_999, expected: ['light', 'pro', 'standard'] },
        { totalBytes: 10_300_000_000, expected: ['light', 'pro', 'standard'] },
        { totalBytes: 10_299_999_999, expected: ['light', 'standard'] },
        { totalBytes: 2_700_000_000, expected: ['light'] },
        { totalBytes: 2_699_999_999, expected: [] },
    ])('offers what $totalBytes bytes clears', ({ totalBytes, expected }) => {
        expect(ids(offeredLocalModels(models, { state: 'known', totalBytes }))).toEqual(expected);
    });

    it('offers the large tier only with a known figure that clears it', () => {
        const withoutFigure = ids(offeredLocalModels(models, { state: 'unavailable' }));
        const withFigure = ids(offeredLocalModels(models, { state: 'known', totalBytes: 64_000_000_000 }));

        expect(withoutFigure).not.toContain('large');
        expect(withFigure).toContain('large');
    });

    it.each([{ state: 'unread' } as const, { state: 'unavailable' } as const])(
        'offers every tier up to Pro and hides the larger ones when the reading is $state',
        (reading) => {
            expect(ids(offeredLocalModels(models, reading))).toEqual(['light', 'pro', 'standard']);
        }
    );
});

describe('chooseOfferedModel', () => {
    const offered = models.filter((model) => model.tier !== 'large');

    it('keeps the wanted model when it is offered', () => {
        expect(chooseOfferedModel(offered, 'light', 'pro')?.id).toBe('light');
    });

    it('falls back to the default when the wanted model is not offered', () => {
        expect(chooseOfferedModel(offered, 'large', 'pro')?.id).toBe('pro');
    });

    it('falls back to the largest offered model when neither is offered', () => {
        const small = offered.filter((model) => model.id !== 'pro');
        expect(chooseOfferedModel(small, 'large', 'pro')?.id).toBe('standard');
    });

    it('chooses nothing when nothing is offered', () => {
        expect(chooseOfferedModel([], 'light', 'pro')).toBeNull();
    });
});
