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

const RAM_64_GB = 64_000_000_000;

describe('offeredLocalModels', () => {
    it.each([
        { totalBytes: 64_000_000_000, gpuBudgetBytes: 48_000_000_000, expected: ['large', 'light', 'pro', 'standard'] },
        { totalBytes: 64_000_000_000, gpuBudgetBytes: 40_000_000_000, expected: ['large', 'light', 'pro', 'standard'] },
        { totalBytes: 64_000_000_000, gpuBudgetBytes: 39_999_999_999, expected: ['light', 'pro', 'standard'] },
        { totalBytes: 64_000_000_000, gpuBudgetBytes: 10_300_000_000, expected: ['light', 'pro', 'standard'] },
        { totalBytes: 64_000_000_000, gpuBudgetBytes: 10_299_999_999, expected: ['light', 'standard'] },
        { totalBytes: 64_000_000_000, gpuBudgetBytes: 8_000_000_000, expected: ['light', 'standard'] },
        { totalBytes: 64_000_000_000, gpuBudgetBytes: 2_699_999_999, expected: [] },
    ])(
        'offers what a $gpuBudgetBytes byte GPU budget clears on 64 GB of RAM',
        ({ gpuBudgetBytes, totalBytes, expected }) => {
            expect(ids(offeredLocalModels(models, { state: 'known', totalBytes, gpuBudgetBytes }))).toEqual(expected);
        }
    );

    it.each([
        { totalBytes: 10_299_999_999, expected: ['light', 'standard'] },
        { totalBytes: 2_699_999_999, expected: [] },
    ])(
        'hides what $totalBytes bytes of RAM cannot hold even when the GPU budget clears it',
        ({ totalBytes, expected }) => {
            const reading = { state: 'known', totalBytes, gpuBudgetBytes: 48_000_000_000 } as const;
            expect(ids(offeredLocalModels(models, reading))).toEqual(expected);
        }
    );

    it.each([
        { totalBytes: RAM_64_GB, expected: ['light', 'pro', 'standard'] },
        { totalBytes: 10_300_000_000, expected: ['light', 'pro', 'standard'] },
        { totalBytes: 10_299_999_999, expected: ['light', 'standard'] },
        { totalBytes: 2_699_999_999, expected: [] },
    ])(
        'offers up to Pro and never Large by RAM alone when the GPU budget is unknown ($totalBytes bytes)',
        ({ totalBytes, expected }) => {
            const reading = { state: 'known', totalBytes, gpuBudgetBytes: null } as const;
            expect(ids(offeredLocalModels(models, reading))).toEqual(expected);
        }
    );

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
