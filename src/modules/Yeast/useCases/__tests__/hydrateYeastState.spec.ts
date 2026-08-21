import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    reconcile: vi.fn(),
    setActive: vi.fn(),
    set: vi.fn(),
    deviceIds: ['device-a', 'device-b'] as string[],
    value: { processors: [], uiLevel: 3 },
}));

vi.mock('../../stores/yeastStore', () => ({
    yeastStore: {
        get value() {
            return mocks.value;
        },
        set: mocks.set,
    },
    setActiveYeastDevice: mocks.setActive,
    yeastDeviceIdsInProjectOrder: () => mocks.deviceIds,
}));
vi.mock('../reconcileYeastGrooveAssignments', () => ({
    reconcileYeastGrooveAssignments: mocks.reconcile,
}));

const { hydrateYeastState } = await import('../hydrateYeastState');

describe('hydrateYeastState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes every device rack from the device-keyed file shape and ends unpinned', () => {
        hydrateYeastState({
            racks: {
                'device-a': { processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }] },
                'device-b': { processors: [] },
            },
        });

        // Each rack is authored while its device is pinned; the final unpin
        // is what leaves load state resolved from selection.
        expect(mocks.setActive.mock.calls).toEqual([['device-a'], ['device-b'], [null]]);
        expect(mocks.set).toHaveBeenCalledWith({
            processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 3,
        });
        expect(mocks.set).toHaveBeenCalledWith({ processors: [], uiLevel: 3 });
        expect(mocks.reconcile).toHaveBeenCalledOnce();
    });

    it('attaches a legacy flat single rack to the first Yeast device only', () => {
        hydrateYeastState({
            processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
        });

        expect(mocks.setActive.mock.calls).toEqual([['device-a'], ['device-b'], [null]]);
        expect(mocks.set).toHaveBeenCalledTimes(2);
        expect(mocks.set).toHaveBeenNthCalledWith(1, {
            processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 3,
        });
        expect(mocks.set).toHaveBeenNthCalledWith(2, { processors: [], uiLevel: 3 });
        expect(mocks.reconcile).toHaveBeenCalledOnce();
    });

    it('clears every device rack when the project carries no yeast section', () => {
        hydrateYeastState(undefined);

        expect(mocks.setActive.mock.calls).toEqual([['device-a'], ['device-b'], [null]]);
        expect(mocks.set).toHaveBeenCalledTimes(2);
        expect(mocks.set).toHaveBeenCalledWith({ processors: [], uiLevel: 3 });
        expect(mocks.reconcile).toHaveBeenCalledOnce();
    });
});
