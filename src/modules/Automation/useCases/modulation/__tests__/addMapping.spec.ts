import { describe, it, expect, beforeEach } from 'vitest';

import { modulationStore } from '../../../stores/modulationStore';
import { addMapping } from '../addMapping';

describe('addMapping', () => {
    beforeEach(() => {
        modulationStore.set({
            modulators: [
                {
                    id: 'a',
                    name: 'A',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [],
                    enabled: true,
                },
            ],
        });
    });

    it('appends a mapping to the matching modulator', () => {
        addMapping('a', { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: 0.5 });
        expect(modulationStore.value?.modulators[0]?.mappings).toEqual([
            { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: 0.5 },
        ]);
    });

    it('preserves the existing amount when a mapping for the same target is re-added', () => {
        // Re-adding a duplicate destination is a no-op: the picker's default amount
        // must not clobber a user-tuned amount (use updateMapping to change it).
        addMapping('a', { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: 0.9 });
        addMapping('a', { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: 0.3 });

        const mappings = modulationStore.value?.modulators[0]?.mappings ?? [];
        expect(mappings).toHaveLength(1);
        expect(mappings[0]?.amount).toBe(0.9);
    });

    it('is a no-op when the modulator id is unknown', () => {
        addMapping('zzz', { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: 0.5 });
        expect(modulationStore.value?.modulators[0]?.mappings).toEqual([]);
    });
});
