import { describe, it, expect, beforeEach } from 'vitest';

import { modulationStore } from '../../../stores/modulationStore';
import { updateMapping } from '../updateMapping';

describe('updateMapping', () => {
    beforeEach(() => {
        modulationStore.set({
            modulators: [
                {
                    id: 'a',
                    name: 'A',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: 0.5 }],
                    enabled: true,
                },
            ],
        });
    });

    it('applies the patch to the matching mapping', () => {
        updateMapping('a', { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1' }, { amount: -0.8 });
        expect(modulationStore.value?.modulators[0]?.mappings[0]?.amount).toBe(-0.8);
    });

    it('never overwrites the target identity', () => {
        updateMapping(
            'a',
            { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1' },
            { targetParamId: 'hacker', amount: 0.1 }
        );
        const mapping = modulationStore.value?.modulators[0]?.mappings[0];
        expect(mapping?.targetParamId).toBe('p1');
        expect(mapping?.amount).toBe(0.1);
    });

    it('is a no-op when the mapping target is unknown', () => {
        updateMapping('a', { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'nope' }, { amount: -1 });
        expect(modulationStore.value?.modulators[0]?.mappings[0]?.amount).toBe(0.5);
    });
});
