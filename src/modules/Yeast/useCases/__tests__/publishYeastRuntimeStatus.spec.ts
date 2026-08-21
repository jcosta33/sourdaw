import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runtimeError: vi.fn((): string | undefined => undefined),
    runtimeStatus: vi.fn((): 'uninitialized' | 'ready' => 'ready'),
    set: vi.fn(),
    setActive: vi.fn(),
    pinned: null as string | null,
    rackByDevice: {} as Record<
        string,
        { processors: never[]; uiLevel: number; runtimeStatus?: string; runtimeError?: string }
    >,
    value: { processors: [], uiLevel: 1 } as {
        processors: never[];
        uiLevel: number;
        runtimeStatus?: string;
        runtimeError?: string;
    },
}));

vi.mock('../../engine/yeastRuntime', () => ({
    getYeastRuntimeStatus: mocks.runtimeStatus,
    getYeastRuntimeError: mocks.runtimeError,
}));
vi.mock('../../stores/yeastStore', () => ({
    yeastStore: {
        get value() {
            return mocks.value;
        },
        set: mocks.set,
    },
    getPinnedYeastDevice: () => mocks.pinned,
    readYeastRack: (deviceId: string) => mocks.rackByDevice[deviceId],
    setActiveYeastDevice: mocks.setActive,
}));

const { publishYeastRuntimeStatus } = await import('../publishYeastRuntimeStatus');

describe('publishYeastRuntimeStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pinned = null;
        mocks.value = { processors: [], uiLevel: 1 };
        mocks.rackByDevice = {};
    });

    it('writes onto the active rack when no rack is named', () => {
        publishYeastRuntimeStatus();

        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ runtimeStatus: 'ready' }));
        expect(mocks.setActive).not.toHaveBeenCalled();
    });

    it('routes a named non-active rack through a temporary pin and restores it', () => {
        // Racks are per device (issue #2422): status from device B's
        // processing belongs on device B's rack, not on the active one.
        // Mutation: routing the write at the active rack regardless of the
        // rackId reds this test.
        mocks.pinned = 'device-a';
        mocks.rackByDevice['device-b'] = { processors: [], uiLevel: 1 };

        publishYeastRuntimeStatus('device-b');

        expect(mocks.setActive.mock.calls).toEqual([['device-b'], ['device-a']]);
        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ runtimeStatus: 'ready' }));
    });

    it('skips the store write when the named rack already carries the status', () => {
        mocks.pinned = 'device-a';
        mocks.rackByDevice['device-b'] = { processors: [], uiLevel: 1, runtimeStatus: 'ready' };

        publishYeastRuntimeStatus('device-b');

        expect(mocks.setActive).not.toHaveBeenCalled();
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('writes directly when the named rack is the pinned one', () => {
        mocks.pinned = 'device-a';

        publishYeastRuntimeStatus('device-a');

        expect(mocks.setActive).not.toHaveBeenCalled();
        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ runtimeStatus: 'ready' }));
    });
});
