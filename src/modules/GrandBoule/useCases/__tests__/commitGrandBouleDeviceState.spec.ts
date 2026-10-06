import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    trackStore: { value: { tracks: [{ devices: [{ id: 'grand-1', type: 'grand-boule', deviceState: undefined }] }] } },
    reconcile: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('../reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

import { commitGrandBouleDeviceState } from '../commitGrandBouleDeviceState';

describe('commitGrandBouleDeviceState', () => {
    it('saves before and after versioned state through the undoable action', () => {
        mocks.executeAppAction.mockResolvedValue(undefined);
        commitGrandBouleDeviceState('grand-1', {
            morph: {
                modelA: 'mellow-grand',
                modelB: 'singing-grand',
                morphPosition: 0.4,
                layerBalance: 0.2,
                enabled: true,
            },
            temperament: 3,
            parameters: { hammerHardness: 0.4, velocityCurve: 0.85, stereoWidth: 0.7, toneTilt: 0.35 },
        });

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'setGrandBouleDeviceState',
            payload: {
                deviceId: 'grand-1',
                before: {
                    version: 1,
                    data: {
                        modelA: 'balanced-grand',
                        modelB: 'clear-grand',
                        morphPosition: 0,
                        layerBalance: 0,
                        enabled: false,
                        temperament: 0,
                        hammerHardness: 0,
                        velocityCurve: 1,
                        stereoWidth: 0.6,
                        toneTilt: 0,
                    },
                },
                after: {
                    version: 1,
                    data: {
                        modelA: 'mellow-grand',
                        modelB: 'singing-grand',
                        morphPosition: 0.4,
                        layerBalance: 0.2,
                        enabled: true,
                        temperament: 3,
                        hammerHardness: 0.4,
                        velocityCurve: 0.85,
                        stereoWidth: 0.7,
                        toneTilt: 0.35,
                    },
                },
            },
        });
    });
});
