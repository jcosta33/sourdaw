import { beforeEach, describe, expect, it, vi } from 'vitest';

import { removeTrackModulationReferences } from '../removeTrackModulationReferences';

const mocks = vi.hoisted(() => ({
    finalizeOwnedModulator: vi.fn(),
    finalizeTargetMapping: vi.fn(),
    modulationStoreValue: {
        value: null as {
            modulators: Array<{
                id: string;
                trackId: string;
                mappings: Array<{
                    targetTrackId: string;
                    targetDeviceId: string;
                    targetParamId: string;
                }>;
            }>;
        } | null,
    },
    removeMapping: vi.fn(),
    removeModulator: vi.fn(),
}));

vi.mock('#/modules/Automation/stores', () => ({
    modulationStore: {
        get value() {
            return mocks.modulationStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Automation/useCases', () => ({
    removeMapping: mocks.removeMapping,
    removeModulator: mocks.removeModulator,
}));

describe('removeTrackModulationReferences', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.removeModulator.mockReturnValue(mocks.finalizeOwnedModulator);
        mocks.removeMapping.mockReturnValue(mocks.finalizeTargetMapping);
        mocks.modulationStoreValue.value = {
            modulators: [
                { id: 'owned', trackId: 'removed', mappings: [] },
                {
                    id: 'survivor',
                    trackId: 'other',
                    mappings: [
                        { targetTrackId: 'removed', targetDeviceId: 'device-a', targetParamId: 'cutoff' },
                        { targetTrackId: 'other', targetDeviceId: 'device-b', targetParamId: 'gain' },
                    ],
                },
            ],
        };
    });

    it('removes only owned modulators and incoming mappings while deferring their runtime effects', () => {
        const runtimeEffects = removeTrackModulationReferences({
            trackId: 'removed',
            deferRuntimeEffects: true,
        });

        expect(mocks.removeModulator).toHaveBeenCalledWith('owned', { deferRuntimeEffects: true });
        expect(mocks.removeMapping).toHaveBeenCalledWith(
            'survivor',
            {
                targetTrackId: 'removed',
                targetDeviceId: 'device-a',
                targetParamId: 'cutoff',
            },
            { deferRuntimeEffects: true }
        );
        expect(mocks.removeMapping).not.toHaveBeenCalledWith(
            'survivor',
            expect.objectContaining({ targetTrackId: 'other' }),
            expect.anything()
        );
        expect(mocks.finalizeOwnedModulator).not.toHaveBeenCalled();
        expect(mocks.finalizeTargetMapping).not.toHaveBeenCalled();

        runtimeEffects.afterCommit();

        expect(mocks.finalizeOwnedModulator).toHaveBeenCalledOnce();
        expect(mocks.finalizeTargetMapping).toHaveBeenCalledOnce();
    });

    it('returns an inert finalizer when modulation state is unavailable', () => {
        mocks.modulationStoreValue.value = null;

        const runtimeEffects = removeTrackModulationReferences({
            trackId: 'removed',
            deferRuntimeEffects: true,
        });

        expect(runtimeEffects.afterCommit).not.toThrow();
        expect(runtimeEffects.afterAmbiguousCommit).not.toThrow();
        expect(mocks.removeModulator).not.toHaveBeenCalled();
        expect(mocks.removeMapping).not.toHaveBeenCalled();
    });

    it('reconciles only removals that are present in durable modulation truth', () => {
        const runtimeEffects = removeTrackModulationReferences({
            trackId: 'removed',
            deferRuntimeEffects: true,
        });

        runtimeEffects.afterAmbiguousCommit();
        expect(mocks.finalizeOwnedModulator).not.toHaveBeenCalled();
        expect(mocks.finalizeTargetMapping).not.toHaveBeenCalled();

        mocks.modulationStoreValue.value = {
            modulators: [
                {
                    id: 'survivor',
                    trackId: 'other',
                    mappings: [{ targetTrackId: 'other', targetDeviceId: 'device-b', targetParamId: 'gain' }],
                },
            ],
        };
        runtimeEffects.afterAmbiguousCommit();

        expect(mocks.finalizeOwnedModulator).toHaveBeenCalledOnce();
        expect(mocks.finalizeTargetMapping).toHaveBeenCalledOnce();
    });
});
