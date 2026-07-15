import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
