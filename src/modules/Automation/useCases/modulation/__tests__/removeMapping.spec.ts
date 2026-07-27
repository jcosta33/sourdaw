import { describe, it, expect, beforeEach, vi } from 'vitest';

import { modulationStore } from '../../../stores/modulationStore';
import { removeMapping } from '../removeMapping';

const mocks = vi.hoisted(() => ({
    revertMappingsToBase: vi.fn(),
}));

vi.mock('../revertMappingsToBase', () => ({
    revertMappingsToBase: mocks.revertMappingsToBase,
}));

describe('removeMapping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        modulationStore.set({
            modulators: [
                {
                    id: 'a',
                    name: 'A',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [
                        { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: 0.5 },
                        { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p2', amount: 0.25 },
                    ],
                    enabled: true,
                },
            ],
        });
    });

    it('removes the mapping whose full target matches', () => {
        removeMapping('a', { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1' });
        const mappings = modulationStore.value?.modulators[0]?.mappings ?? [];
        expect(mappings.map((x) => x.targetParamId)).toEqual(['p2']);
    });

    it('defers the live parameter reset until project truth commits', () => {
        const finalizeRuntimeEffects = removeMapping(
            'a',
            { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1' },
            { deferRuntimeEffects: true }
        );

        expect(modulationStore.value?.modulators[0]?.mappings.map((mapping) => mapping.targetParamId)).toEqual(['p2']);
        expect(mocks.revertMappingsToBase).not.toHaveBeenCalled();

        finalizeRuntimeEffects?.();

        expect(mocks.revertMappingsToBase).toHaveBeenCalledWith([
            { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: 0.5 },
        ]);
    });

    it('is a no-op when the modulator id is unknown', () => {
        removeMapping('zzz', { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1' });
        expect(modulationStore.value?.modulators[0]?.mappings).toHaveLength(2);
    });

    it('is a no-op when the target does not match any mapping', () => {
        removeMapping('a', { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'nope' });
        expect(modulationStore.value?.modulators[0]?.mappings).toHaveLength(2);
    });
});
