import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    trackStore: { value: { tracks: [{ devices: [{ id: 'grand-1', type: 'grand-boule', deviceState: undefined }] }] } },
    reconcile: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.executeAppAction }));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('../reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

import { commitGrandBouleDeviceState } from '../commitGrandBouleDeviceState';

describe('commitGrandBouleDeviceState', () => {
    it('saves before and after versioned state through the undoable action', () => {
        mocks.executeAppAction.mockResolvedValue(undefined);
        commitGrandBouleDeviceState('grand-1', {
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: 0.2,
            enabled: true,
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
                    },
                },
            },
        });
    });
});
