import { beforeEach, describe, expect, it } from 'vitest';

import { yeastStore } from '../yeastStore';

describe('yeastStore', () => {
    beforeEach(() => {
        yeastStore.set({ processors: [], uiLevel: 1 });
    });

    it('stores the serializable processor projection and runtime availability only', () => {
        yeastStore.set({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
            uiLevel: 2,
            runtimeStatus: 'ready',
        });

        expect(yeastStore.value).toEqual({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
            uiLevel: 2,
            runtimeStatus: 'ready',
        });
        expect(yeastStore.value).not.toHaveProperty('rackInstance');
        expect(yeastStore.value).not.toHaveProperty('_worker');
    });

    it('continues to accept serialized projections without optional parameter state', () => {
        yeastStore.set({
            processors: [{ id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false }],
            uiLevel: 1,
        });

        expect(yeastStore.value?.processors[0]).toEqual({
            id: 'arp-1',
            type: 'arpeggiator',
            name: 'Arpeggiator',
            bypassed: false,
        });
    });
});
