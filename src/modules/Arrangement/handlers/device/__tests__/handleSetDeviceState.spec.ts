import { describe, expect, it, vi } from 'vitest';

const { mockSetDeviceState } = vi.hoisted(() => ({ mockSetDeviceState: vi.fn() }));

vi.mock('../../../useCases/device/setDeviceState', () => ({ setDeviceState: mockSetDeviceState }));
vi.mock('../../toHandlerExecutionResult', () => ({
    toHandlerExecutionResult: (result: unknown) => ({ status: result ? 'written' : 'no-write' }),
}));

import { handleSetDeviceState } from '../handleSetDeviceState';

const action = {
    type: 'setDeviceState' as const,
    payload: { deviceId: 'device-1', state: { version: 1, data: {} } },
};

describe('handleSetDeviceState', () => {
    it('execute calls setDeviceState with deviceId and state', () => {
        mockSetDeviceState.mockReturnValue(true);
        handleSetDeviceState.execute(action);
        expect(mockSetDeviceState).toHaveBeenCalledExactlyOnceWith({
            deviceId: 'device-1',
            state: { version: 1, data: {} },
        });
    });

    it('describe returns the correct label', () => {
        const result = handleSetDeviceState.describe(action);
        expect(result.label).toBe('Capture device state');
    });

    it('is not undoable', () => {
        expect(handleSetDeviceState.undoable).toBe(false);
    });
});
