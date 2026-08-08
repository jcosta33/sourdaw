import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    toLevainDeviceState: vi.fn(),
    levainStore: { value: null as Record<string, { patch: unknown }> | null },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../../models/LevainDeviceState', () => ({
    toLevainDeviceState: mocks.toLevainDeviceState,
}));

vi.mock('../../stores/levainStore', () => ({
    levainStore: mocks.levainStore,
}));

import { commitLevainDeviceState } from '../commitLevainDeviceState';

describe('commitLevainDeviceState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.levainStore.value = null;
    });

    it('is a no-op when the store is null', () => {
        mocks.levainStore.value = null;

        commitLevainDeviceState('dev-1');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('is a no-op when the device has no patch', () => {
        mocks.levainStore.value = {};

        commitLevainDeviceState('dev-1');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('serializes the patch and fires setDeviceState via executeAppAction', () => {
        const patch = { instrument: 'piano' };
        const serialized = { version: 1, instrument: 'piano' };
        mocks.levainStore.value = { 'dev-1': { patch } };
        mocks.toLevainDeviceState.mockReturnValue(serialized);

        commitLevainDeviceState('dev-1');

        expect(mocks.toLevainDeviceState).toHaveBeenCalledWith(patch);
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        const [action, options] = mocks.executeAppAction.mock.calls[0]!;
        expect(action).toEqual({ type: 'setDeviceState', payload: { deviceId: 'dev-1', state: serialized } });
        expect(options).toEqual({ skipMacroRecording: true });
    });

    it('fire-and-forget: does not await executeAppAction (void)', () => {
        mocks.levainStore.value = { 'dev-1': { patch: {} } };
        mocks.toLevainDeviceState.mockReturnValue({});

        // The function returns void — no promise to await.
        const result = commitLevainDeviceState('dev-1');

        expect(result).toBeUndefined();
    });

    it('does not commit other devices when targeting a specific one', () => {
        mocks.levainStore.value = {
            'dev-1': { patch: { instrument: 'piano' } },
            'dev-2': { patch: { instrument: 'strings' } },
        };
        mocks.toLevainDeviceState.mockReturnValue({ instrument: 'piano' });

        commitLevainDeviceState('dev-1');

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        const action = mocks.executeAppAction.mock.calls[0]?.[0];
        expect(action.payload.deviceId).toBe('dev-1');
    });
});
