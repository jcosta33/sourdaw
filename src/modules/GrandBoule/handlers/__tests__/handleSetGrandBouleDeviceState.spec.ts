import { beforeEach, describe, expect, it, vi } from 'vitest';

const before = {
    version: 1,
    data: {
        modelA: 'balanced-grand',
        modelB: 'clear-grand',
        morphPosition: 0,
        layerBalance: 0,
        enabled: false,
    },
};
const after = { ...before, data: { ...before.data, morphPosition: 0.75, enabled: true } };
const mocks = vi.hoisted(() => ({
    setDeviceState: vi.fn(),
    reconcile: vi.fn(),
    trackStore: {
        value: {
            tracks: [
                {
                    devices: [
                        {
                            id: 'grand-1',
                            type: 'grand-boule',
                            deviceState: {
                                version: 1,
                                data: {
                                    modelA: 'balanced-grand',
                                    modelB: 'clear-grand',
                                    morphPosition: 0,
                                    layerBalance: 0,
                                    enabled: false,
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({ setDeviceState: mocks.setDeviceState }));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('../../useCases/reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

import { handleSetGrandBouleDeviceState } from '../handleSetGrandBouleDeviceState';

function grandBouleDevice() {
    const device = mocks.trackStore.value.tracks.at(0)?.devices.at(0);
    if (device === undefined) {
        throw new Error('Grand Boule test fixture is missing its device');
    }
    return device;
}

describe('handleSetGrandBouleDeviceState', () => {
    beforeEach(() => {
        mocks.setDeviceState.mockReset().mockReturnValue(true);
        mocks.reconcile.mockReset();
        grandBouleDevice().deviceState = before;
    });

    it('writes project truth and reconciles session plus engine after commit', async () => {
        const action = { type: 'setGrandBouleDeviceState' as const, payload: { deviceId: 'grand-1', before, after } };
        const result = await handleSetGrandBouleDeviceState.execute(action);

        expect(mocks.setDeviceState).toHaveBeenCalledWith({ deviceId: 'grand-1', state: after });
        expect(result?.status).toBe('written');
        await result?.afterCommit?.();
        expect(mocks.reconcile).toHaveBeenCalledWith('grand-1');
    });

    it('describes an inverse that swaps the versioned states', () => {
        const action = { type: 'setGrandBouleDeviceState' as const, payload: { deviceId: 'grand-1', before, after } };

        expect(handleSetGrandBouleDeviceState.describe(action).inverseAction).toEqual({
            type: 'setGrandBouleDeviceState',
            payload: { deviceId: 'grand-1', before: after, after: before },
        });
    });

    it('conflicts instead of overwriting a changed project state', async () => {
        grandBouleDevice().deviceState = after;

        const result = await handleSetGrandBouleDeviceState.execute({
            type: 'setGrandBouleDeviceState',
            payload: { deviceId: 'grand-1', before, after },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setDeviceState).not.toHaveBeenCalled();
    });
});
