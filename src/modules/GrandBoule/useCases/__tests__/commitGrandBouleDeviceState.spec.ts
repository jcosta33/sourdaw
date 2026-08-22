import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    trackStore: { value: { tracks: [{ devices: [{ id: 'grand-1', deviceState: undefined }] }] } },
    store: {
        value: {
            morph: {
                modelA: 'mellow-grand',
                modelB: 'singing-grand',
                morphPosition: 0.4,
                layerBalance: 0.2,
                enabled: true,
            },
        },
    },
}));

vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.executeAppAction }));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('../../stores/grandBouleStore', () => ({ createGrandBouleStore: () => mocks.store }));

import { commitGrandBouleDeviceState } from '../commitGrandBouleDeviceState';

describe('commitGrandBouleDeviceState', () => {
    it('saves the versioned voicing chunk through setDeviceState', () => {
        commitGrandBouleDeviceState('grand-1');

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            {
                type: 'setDeviceState',
                payload: {
                    deviceId: 'grand-1',
                    state: {
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
            },
            { skipMacroRecording: true }
        );
    });
});
