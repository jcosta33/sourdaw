import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    callOrder: [] as string[],
    selectDevice: vi.fn(),
    openInspector: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    selectDevice: (deviceId: string) => {
        mocks.callOrder.push('selectDevice');
        mocks.selectDevice(deviceId);
    },
}));
vi.mock('../../togglePanel/panelToggles/openInspector', () => ({
    openInspector: () => {
        mocks.callOrder.push('openInspector');
        mocks.openInspector();
    },
}));

import { revealDeviceInInspector } from '../revealDeviceInInspector';

describe('revealDeviceInInspector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.callOrder.length = 0;
    });

    it('selects the device and then opens the inspector', () => {
        revealDeviceInInspector('device-1');

        expect(mocks.selectDevice).toHaveBeenCalledExactlyOnceWith('device-1');
        expect(mocks.openInspector).toHaveBeenCalledOnce();
        expect(mocks.callOrder).toEqual(['selectDevice', 'openInspector']);
    });
});
