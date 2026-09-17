import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setDeviceState: vi.fn(),
    getTrackStoreState: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(),
    projectsToDifferentNativeBank: vi.fn(),
}));

vi.mock('../../../useCases/device/setDeviceState', () => ({ setDeviceState: mocks.setDeviceState }));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: mocks.mirrorDeviceChainDelta,
    projectsToDifferentNativeBank: mocks.projectsToDifferentNativeBank,
}));
vi.mock('../../toHandlerExecutionResult', () => ({
    toHandlerExecutionResult: (result: unknown) => ({ status: result ? 'written' : 'no-write' }),
}));

import { handleSetDeviceState } from '../handleSetDeviceState';

const action = {
    type: 'setDeviceState' as const,
    payload: { deviceId: 'device-1', state: { version: 1, data: {} } },
};

function device(overrides: Record<string, unknown>) {
    return {
        id: 'device-1',
        name: 'device-1',
        type: 'levain',
        bypassed: false,
        parameterValues: {},
        ...overrides,
    };
}

function track(devices: readonly unknown[]) {
    return { id: 'audio-1', name: 'Lead', devices };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTrackStoreState.mockReturnValue(undefined);
    mocks.mirrorDeviceChainDelta.mockResolvedValue({ outcome: 'mirrored' });
});

describe('handleSetDeviceState', () => {
    it('execute calls setDeviceState with deviceId and state', () => {
        mocks.setDeviceState.mockReturnValue(true);

        handleSetDeviceState.execute(action);

        expect(mocks.setDeviceState).toHaveBeenCalledExactlyOnceWith({
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

    /**
     * The one `deviceState` change a rolling native session cannot hear on its
     * own: picking another Levain instrument keeps the device's id and
     * position, so nothing about the write looks like a chain edit, yet the
     * engine's held instance was built from the old bank (#4203).
     */
    it('mirrors the swap onto a rolling native session when the write changes the projected bank key', async () => {
        const beforeDevice = device({ deviceState: { bank: 'trumpet' } });
        const afterDevice = device({ deviceState: { bank: 'violin' } });
        mocks.setDeviceState.mockReturnValue(true);
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [track([beforeDevice])] })
            .mockReturnValueOnce({ tracks: [track([afterDevice])] });
        mocks.projectsToDifferentNativeBank.mockImplementation(
            (before: { deviceState?: { bank?: string } }, after: { deviceState?: { bank?: string } }) =>
                before.deviceState?.bank !== after.deviceState?.bank
        );

        const result = handleSetDeviceState.execute(action);
        if (!result || result instanceof Promise || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a deferred native mirror');
        }
        expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();

        await result.afterCommit();

        expect(mocks.mirrorDeviceChainDelta).toHaveBeenCalledExactlyOnceWith({
            before: track([beforeDevice]),
            after: track([afterDevice]),
        });
    });

    // Any other `deviceState` field — an articulation choice with no bank
    // consequence, for instance — leaves the projected bank key exactly where
    // it was, so the write owes the native session nothing.
    it('does not mirror a write that leaves the projected bank key unchanged', () => {
        const beforeDevice = device({ deviceState: { bank: 'trumpet', articulation: 'legato' } });
        const afterDevice = device({ deviceState: { bank: 'trumpet', articulation: 'staccato' } });
        mocks.setDeviceState.mockReturnValue(true);
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [track([beforeDevice])] })
            .mockReturnValueOnce({ tracks: [track([afterDevice])] });
        mocks.projectsToDifferentNativeBank.mockImplementation(
            (before: { deviceState?: { bank?: string } }, after: { deviceState?: { bank?: string } }) =>
                before.deviceState?.bank !== after.deviceState?.bank
        );

        const result = handleSetDeviceState.execute(action);

        expect(result).toEqual({ status: 'written' });
        expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();
    });

    // No track carries the id, so `setDeviceState` itself declines the write;
    // there is no before/after pair to compare and nothing to mirror.
    it('writes nothing and mirrors nothing for a device id no track holds', () => {
        mocks.setDeviceState.mockReturnValue(false);

        const result = handleSetDeviceState.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.mirrorDeviceChainDelta).not.toHaveBeenCalled();
    });
});
