import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { createCrdtDoc, mutateCrdtDoc, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { TrackDummy } from '../../__tests__/TrackDummy';
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
    automationStore: {
        value: { lanes: [] },
        hydrate: vi.fn(),
    },
    modulationStore: {
        get value() {
            return mocks.modulationStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationLaneCeiling: vi.fn(),
    removeMapping: mocks.removeMapping,
    removeModulator: mocks.removeModulator,
}));

describe('removeTrackModulationReferences', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        removeCrdtDoc('root');
        createCrdtDoc('root');
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

        mocks.modulationStoreValue.value = { modulators: [] };
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
    it.each(['afterCommit', 'afterAmbiguousCommit'] as const)(
        'releases removed modulation ownership even when the track remains present, phase=%s',
        (phase) => {
            const effects = removeTrackModulationReferences({ trackId: 'removed', deferRuntimeEffects: true });
            mocks.modulationStoreValue.value = { modulators: [] };
            mutateCrdtDoc<{ tracks: { tracks: Array<ReturnType<typeof TrackDummy.create>> } }>({
                id: 'root',
                changeFn: (document) => {
                    document.tracks = { tracks: [TrackDummy.create({ id: 'removed' })] };
                },
            });

            effects[phase]();

            expect(mocks.finalizeOwnedModulator).toHaveBeenCalledOnce();
            expect(mocks.finalizeTargetMapping).toHaveBeenCalledOnce();
        }
    );

    it.each(['afterCommit', 'afterAmbiguousCommit'] as const)(
        'keeps a restored or reused modulator identity and restored exact mapping, phase=%s',
        (phase) => {
            const effects = removeTrackModulationReferences({ trackId: 'removed', deferRuntimeEffects: true });
            // Reusing the id for another track still installs a current runtime owner.
            mocks.modulationStoreValue.value = {
                modulators: [
                    { id: 'owned', trackId: 'successor', mappings: [] },
                    {
                        id: 'survivor',
                        trackId: 'other',
                        mappings: [{ targetTrackId: 'removed', targetDeviceId: 'device-a', targetParamId: 'cutoff' }],
                    },
                ],
            };

            effects[phase]();

            expect(mocks.finalizeOwnedModulator).not.toHaveBeenCalled();
            expect(mocks.finalizeTargetMapping).not.toHaveBeenCalled();
        }
    );

    it.each(['afterCommit', 'afterAmbiguousCommit'] as const)(
        'rechecks the exact mapping after an earlier finalizer restores it, phase=%s',
        (phase) => {
            const effects = removeTrackModulationReferences({ trackId: 'removed', deferRuntimeEffects: true });
            mocks.modulationStoreValue.value = { modulators: [] };
            mocks.finalizeOwnedModulator.mockImplementationOnce(() => {
                mocks.modulationStoreValue.value = {
                    modulators: [
                        {
                            id: 'survivor',
                            trackId: 'other',
                            mappings: [
                                { targetTrackId: 'removed', targetDeviceId: 'device-a', targetParamId: 'cutoff' },
                            ],
                        },
                    ],
                };
            });

            effects[phase]();

            expect(mocks.finalizeOwnedModulator).toHaveBeenCalledOnce();
            expect(mocks.finalizeTargetMapping).not.toHaveBeenCalled();
        }
    );

    it.each(['afterCommit', 'afterAmbiguousCommit'] as const)(
        'finishes a sibling mapping cleanup when owned-modulator cleanup fails, phase=%s',
        (phase) => {
            const effects = removeTrackModulationReferences({ trackId: 'removed', deferRuntimeEffects: true });
            mocks.modulationStoreValue.value = { modulators: [] };
            mocks.finalizeOwnedModulator.mockImplementationOnce(() => {
                throw new Error('Owned cleanup refused');
            });

            expect(() => effects[phase]()).toThrow('Owned cleanup refused');
            expect(mocks.finalizeTargetMapping).toHaveBeenCalledOnce();
        }
    );

    afterEach(() => removeCrdtDoc('root'));

    it.each(['afterCommit', 'afterAmbiguousCommit'] as const)(
        'retires remaining modulation runtime effects when its first cleanup replaces the root, phase=%s',
        (phase) => {
            const effects = removeTrackModulationReferences({ trackId: 'removed', deferRuntimeEffects: true });
            mocks.modulationStoreValue.value = { modulators: [] };
            mocks.finalizeOwnedModulator.mockImplementationOnce(() => {
                removeCrdtDoc('root');
                createCrdtDoc('root');
            });
            effects[phase]();
            expect(mocks.finalizeOwnedModulator).toHaveBeenCalledOnce();
            expect(mocks.finalizeTargetMapping).not.toHaveBeenCalled();
        }
    );
});
