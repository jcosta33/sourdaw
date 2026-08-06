import { describe, expect, it, vi } from 'vitest';

const { mockCrumbsStore, mockExecuteAppAction } = vi.hoisted(() => ({
    mockCrumbsStore: { value: null as Record<string, { mode: string; activeSample: unknown }> | null },
    mockExecuteAppAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mockExecuteAppAction }));
vi.mock('../../stores/crumbsStore', () => ({ crumbsStore: mockCrumbsStore }));

import { commitCrumbsDeviceState } from '../commitCrumbsDeviceState';

describe('commitCrumbsDeviceState', () => {
    it('does nothing when the device has no state in the store', () => {
        mockCrumbsStore.value = {};
        commitCrumbsDeviceState('device-missing');
        expect(mockExecuteAppAction).not.toHaveBeenCalled();
    });

    it('does nothing when the store value is null', () => {
        mockCrumbsStore.value = null;
        commitCrumbsDeviceState('any-device');
        expect(mockExecuteAppAction).not.toHaveBeenCalled();
    });

    it('dispatches setDeviceState with mode and activeSample when the device is found', () => {
        mockCrumbsStore.value = {
            'device-1': { mode: 'slicer', activeSample: { id: 'sample-1', name: 'Kick' } },
        };
        vi.clearAllMocks();
        mockCrumbsStore.value = {
            'device-1': { mode: 'slicer', activeSample: { id: 'sample-1', name: 'Kick' } },
        };
        commitCrumbsDeviceState('device-1');
        expect(mockExecuteAppAction).toHaveBeenCalledTimes(1);
        const [action, options] = mockExecuteAppAction.mock.calls[0]!;
        expect(action.type).toBe('setDeviceState');
        expect(action.payload.deviceId).toBe('device-1');
        expect(action.payload.state).toBeDefined();
        expect(options).toEqual({ skipMacroRecording: true });
    });
});
