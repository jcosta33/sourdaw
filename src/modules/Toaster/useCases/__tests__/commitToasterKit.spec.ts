import { describe, expect, it, vi } from 'vitest';

const { mockToasterStore, mockExecuteAppAction } = vi.hoisted(() => ({
    mockToasterStore: { value: null as Record<string, { kit: unknown }> | null },
    mockExecuteAppAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mockExecuteAppAction }));
vi.mock('../../stores/toasterStore', () => ({ toasterStore: mockToasterStore }));

import { commitToasterKit } from '../commitToasterKit';

const sampleKit = {
    pads: [{ name: 'Kick', engineType: 'synth', sample: null }],
};

describe('commitToasterKit', () => {
    it('does nothing when the device has no kit in the store', () => {
        mockToasterStore.value = {};
        commitToasterKit('device-missing');
        expect(mockExecuteAppAction).not.toHaveBeenCalled();
    });

    it('does nothing when the store value is null', () => {
        mockToasterStore.value = null;
        commitToasterKit('any-device');
        expect(mockExecuteAppAction).not.toHaveBeenCalled();
    });

    it('dispatches setDeviceState with the serialized kit when the device is found', () => {
        mockToasterStore.value = { 'device-1': { kit: sampleKit } };
        vi.clearAllMocks();
        commitToasterKit('device-1');
        expect(mockExecuteAppAction).toHaveBeenCalledTimes(1);
        const [action, options] = mockExecuteAppAction.mock.calls[0]!;
        expect(action.type).toBe('setDeviceState');
        expect(action.payload.deviceId).toBe('device-1');
        expect(action.payload.state).toBeDefined();
        expect(options).toEqual({ skipMacroRecording: true });
    });
});
