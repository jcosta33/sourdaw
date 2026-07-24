import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetExternalPluginState } from '../handleSetExternalPluginState';

const mocks = vi.hoisted(() => ({
    setExternalPluginState: vi.fn<(deviceId: string, stateChunk: string) => boolean>(),
}));

vi.mock('../../../useCases/device/setExternalPluginState', () => ({
    setExternalPluginState: mocks.setExternalPluginState,
}));

describe('handleSetExternalPluginState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates the chunk write once and reports a write', () => {
        mocks.setExternalPluginState.mockReturnValue(true);

        const result = handleSetExternalPluginState.execute({
            type: 'setExternalPluginState',
            payload: { deviceId: 'd1', stateChunk: 'YmFzZTY0' },
        });

        expect(mocks.setExternalPluginState).toHaveBeenCalledWith('d1', 'YmFzZTY0');
        expect(mocks.setExternalPluginState).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when no device carries the id', () => {
        mocks.setExternalPluginState.mockReturnValue(false);

        const result = handleSetExternalPluginState.execute({
            type: 'setExternalPluginState',
            payload: { deviceId: 'd1', stateChunk: 'x' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('is not undoable and carries a stable label with no inverse', () => {
        expect(handleSetExternalPluginState.undoable).toBe(false);
        expect(
            handleSetExternalPluginState.describe({
                type: 'setExternalPluginState',
                payload: { deviceId: 'd1', stateChunk: 'x' },
            })
        ).toEqual({ label: 'Capture plugin state' });
    });
});
