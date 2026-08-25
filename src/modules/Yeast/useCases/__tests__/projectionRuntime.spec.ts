import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createYeastProcessorProjection } from '../../models/YeastProcessorProjection';

const store = vi.hoisted(() => ({
    value: {
        processors: [],
        uiLevel: 1 as const,
    },
    set: vi.fn(),
}));

const setProjection = vi.hoisted(() => vi.fn());

vi.mock('../../stores/yeastStore', () => ({
    yeastStore: store,
    // Groove-assignment reconcile reads the union of every rack; the mocked
    // store's value is the only one these tests carry.
    readAllYeastRacks: () => [store.value ?? { processors: [], uiLevel: 1 }],
}));

vi.mock('../../engine/yeastRuntime', () => ({
    setYeastRuntimeProjection: setProjection,
}));

const { addYeastProcessor } = await import('../addYeastProcessor');

describe('addYeastProcessor — projection/runtime ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store.value = { processors: [], uiLevel: 1 };
        vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1' });
    });

    it('writes serializable projection state and publishes the same snapshot to the runtime', () => {
        addYeastProcessor('arpeggiator');

        expect(store.set).toHaveBeenCalledWith({
            processors: [
                {
                    id: 'arpeggiator-uuid-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: {},
                },
            ],
            uiLevel: 1,
        });
        expect(setProjection).toHaveBeenCalledWith([
            {
                id: 'arpeggiator-uuid-1',
                type: 'arpeggiator',
                bypassed: false,
                params: {},
            },
        ]);
    });

    it('strips legacy Chord Memory command keys while retaining durable parameters', () => {
        expect(
            createYeastProcessorProjection([
                {
                    id: 'cm-1',
                    type: 'chordMemory',
                    bypassed: false,
                    params: { learn: 1, clear: 1, transpose_mode: 0 },
                },
            ])
        ).toEqual([
            {
                id: 'cm-1',
                type: 'chordMemory',
                bypassed: false,
                params: { transpose_mode: 0 },
            },
        ]);
    });
});
