import { describe, it, expect, beforeEach } from 'vitest';

import { modulationStore } from '../../../stores/modulationStore';
import { removeMapping } from '../removeMapping';

describe('removeMapping', () => {
    beforeEach(() => {
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

    it('removes the mapping whose targetParamId matches', () => {
        removeMapping('a', 'p1');
        const mappings = modulationStore.value?.modulators[0]?.mappings ?? [];
        expect(mappings.map((x) => x.targetParamId)).toEqual(['p2']);
    });

    it('is a no-op when the modulator id is unknown', () => {
        removeMapping('zzz', 'p1');
        expect(modulationStore.value?.modulators[0]?.mappings).toHaveLength(2);
    });

    it('is a no-op when the target param id does not match any mapping', () => {
        removeMapping('a', 'nope');
        expect(modulationStore.value?.modulators[0]?.mappings).toHaveLength(2);
    });
});
