import { beforeEach, describe, expect, it } from 'vitest';

import { modulationStore } from '../../../stores/modulationStore';
import { restoreTrackModulationReferences } from '../restoreTrackModulationReferences';

const existingModulator = {
    id: 'existing',
    name: 'Existing',
    trackId: 'survivor',
    kind: 'lfo',
    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
    mappings: [{ targetTrackId: 'other', targetDeviceId: 'device-b', targetParamId: 'gain', amount: 0.25 }],
    enabled: true,
} as const;

const ownedModulator = {
    id: 'owned',
    name: 'Owned',
    trackId: 'restored',
    kind: 'step',
    config: { kind: 'step', steps: [0, 1], rate: 0.5, smooth: 0.1 },
    mappings: [],
    enabled: true,
} as const;

describe('restoreTrackModulationReferences', () => {
    beforeEach(() => {
        modulationStore.set({
            modulators: [
                {
                    ...existingModulator,
                    config: { ...existingModulator.config },
                    mappings: existingModulator.mappings.map((mapping) => ({ ...mapping })),
                },
            ],
        });
    });

    it('restores owned modulators and incoming mappings without replacing unrelated state', () => {
        restoreTrackModulationReferences({
            ownedModulators: [ownedModulator],
            incomingMappings: [
                {
                    modulatorId: 'existing',
                    mapping: {
                        targetTrackId: 'restored',
                        targetDeviceId: 'device-a',
                        targetParamId: 'cutoff',
                        amount: 0.5,
                    },
                },
            ],
        });

        expect(modulationStore.value?.modulators).toEqual([
            {
                ...existingModulator,
                config: { ...existingModulator.config },
                mappings: [
                    ...existingModulator.mappings,
                    {
                        targetTrackId: 'restored',
                        targetDeviceId: 'device-a',
                        targetParamId: 'cutoff',
                        amount: 0.5,
                    },
                ],
            },
            ownedModulator,
        ]);
    });

    it('is idempotent for already-restored ids and mapping destinations', () => {
        restoreTrackModulationReferences({
            ownedModulators: [existingModulator],
            incomingMappings: [
                {
                    modulatorId: 'existing',
                    mapping: existingModulator.mappings[0],
                },
            ],
        });

        expect(modulationStore.value?.modulators).toHaveLength(1);
        expect(modulationStore.value?.modulators[0]?.mappings).toHaveLength(1);
    });
});
