import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LEGACY_SHARED_RACK_DEVICE_ID } from '../../stores/yeastAutomergeStorage';

const mocks = vi.hoisted(() => ({
    reconcile: vi.fn(),
    setActive: vi.fn(),
    set: vi.fn(),
    deviceIds: ['device-a', 'device-b'] as string[],
    value: { processors: [], uiLevel: 3 },
}));

vi.mock('../../stores/yeastStore', async () => {
    // The reserved legacy key is real module state, not test state: take it
    // from the storage module so this mock cannot drift from the contract.
    const { LEGACY_SHARED_RACK_DEVICE_ID } = await import('../../stores/yeastAutomergeStorage');
    return {
        yeastStore: {
            get value() {
                return mocks.value;
            },
            set: mocks.set,
        },
        setActiveYeastDevice: mocks.setActive,
        yeastDeviceIdsInProjectOrder: () => mocks.deviceIds,
        LEGACY_SHARED_RACK_DEVICE_ID,
    };
});
vi.mock('../reconcileYeastGrooveAssignments', () => ({
    reconcileYeastGrooveAssignments: mocks.reconcile,
}));

const { hydrateYeastState } = await import('../hydrateYeastState');

describe('hydrateYeastState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.deviceIds = ['device-a', 'device-b'];
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

    it('writes racks for devices that exist only in stored arrangements', () => {
        // The write side unions every stored arrangement's Yeast devices into
        // the file, and the live track enumeration at load knows only the
        // ACTIVE arrangement's devices: a device that lives in arrangement B
        // while A is active is absent from the enumeration, and nothing else
        // re-hydrates it (switchArrangement performs no yeast hydration), so
        // a live-only enumeration silently drops its rack and the next save
        // persists the loss. Mutation: reverting the write loop to the
        // live-only enumeration reds this test.
        mocks.deviceIds = ['device-live'];
        const storedRack = {
            processors: [{ id: 'stored-groove', type: 'groove' as const, name: 'Stored', bypassed: false }],
        };

        hydrateYeastState({
            racks: {
                'device-live': { processors: [] },
                'device-stored': storedRack,
            },
        });

        expect(mocks.setActive.mock.calls).toEqual([['device-live'], ['device-stored'], [null]]);
        expect(mocks.set).toHaveBeenCalledWith({
            processors: [{ id: 'stored-groove', type: 'groove', name: 'Stored', bypassed: false }],
            uiLevel: 3,
        });
    });

    it('parks a legacy flat rack when no live Yeast device exists', () => {
        // A pre-split file whose active arrangement holds no Yeast device:
        // attaching to the live-first device would drop the rack entirely.
        // The CRDT v1 path parks it under the reserved legacy key until a
        // first device adopts; the flat path must do the same. Mutation:
        // dropping the parked fallback reds this test.
        mocks.deviceIds = [];
        const flat = [{ id: 'legacy-groove', type: 'groove' as const, name: 'Legacy', bypassed: false }];

        hydrateYeastState({ processors: flat });

        expect(mocks.setActive.mock.calls).toEqual([[LEGACY_SHARED_RACK_DEVICE_ID], [null]]);
        expect(mocks.set).toHaveBeenCalledWith({
            processors: [{ id: 'legacy-groove', type: 'groove', name: 'Legacy', bypassed: false }],
            uiLevel: 3,
        });
    });

    it('clears every device rack when the project carries no yeast section', () => {
        hydrateYeastState(undefined);

        expect(mocks.setActive.mock.calls).toEqual([['device-a'], ['device-b'], [null]]);
        expect(mocks.set).toHaveBeenCalledTimes(2);
        expect(mocks.set).toHaveBeenCalledWith({ processors: [], uiLevel: 3 });
        expect(mocks.reconcile).toHaveBeenCalledOnce();
    });
});
