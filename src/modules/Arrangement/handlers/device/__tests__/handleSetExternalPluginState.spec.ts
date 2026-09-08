import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetExternalPluginState } from '../handleSetExternalPluginState';

import type { ExternalPluginStateWrite } from '../../../useCases/device/setExternalPluginState';

const mocks = vi.hoisted(() => ({
    setExternalPluginState: vi.fn<(payload: unknown) => ExternalPluginStateWrite>(),
}));

vi.mock('../../../useCases/device/setExternalPluginState', () => ({
    setExternalPluginState: mocks.setExternalPluginState,
}));

describe('handleSetExternalPluginState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates the chunk write once and reports a write', () => {
        mocks.setExternalPluginState.mockReturnValue({ didWrite: true });

        const result = handleSetExternalPluginState.execute({
            type: 'setExternalPluginState',
            payload: { intent: 'replacement', deviceId: 'd1', stateChunk: 'YmFzZTY0' },
        });

        expect(mocks.setExternalPluginState).toHaveBeenCalledWith({
            intent: 'replacement',
            deviceId: 'd1',
            stateChunk: 'YmFzZTY0',
        });
        expect(mocks.setExternalPluginState).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when no device carries the id', () => {
        mocks.setExternalPluginState.mockReturnValue({ didWrite: false });

        const result = handleSetExternalPluginState.execute({
            type: 'setExternalPluginState',
            payload: { intent: 'replacement', deviceId: 'd1', stateChunk: 'x' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    // A rejected restore left the host on its defaults, so the replacement must
    // reach it before the capture that follows this action reads the host: the
    // push rides the post-commit hooks, which executeAppAction awaits.
    it('wires the replacement push as post-commit work when the write carries one', () => {
        const pushReplacementToHost = vi.fn<() => Promise<void>>();
        mocks.setExternalPluginState.mockReturnValue({ didWrite: true, pushReplacementToHost });

        const result = handleSetExternalPluginState.execute({
            type: 'setExternalPluginState',
            payload: { intent: 'replacement', deviceId: 'd1', stateChunk: 'YmFzZTY0' },
        });

        expect(result).toEqual({
            status: 'written',
            afterCommit: pushReplacementToHost,
            afterAmbiguousCommit: pushReplacementToHost,
        });
    });

    it('is not undoable and carries a stable label with no inverse', () => {
        expect(handleSetExternalPluginState.undoable).toBe(false);
        expect(
            handleSetExternalPluginState.describe({
                type: 'setExternalPluginState',
                payload: { intent: 'replacement', deviceId: 'd1', stateChunk: 'x' },
            })
        ).toEqual({ label: 'Capture plugin state' });
    });
});
