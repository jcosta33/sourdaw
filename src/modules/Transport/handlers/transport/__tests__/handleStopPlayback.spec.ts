import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleStopPlayback } from '../handleStopPlayback';

const mocks = vi.hoisted(() => ({
    stopPlayback: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../../useCases/transportControls/stopPlayback', () => ({
    stopPlayback: mocks.stopPlayback,
}));

describe('handleStopPlayback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('classifies Stop as a non-undoable runtime command', () => {
        expect(handleStopPlayback.executionKind).toBe('runtime');
        expect(handleStopPlayback.undoable).toBe(false);
    });

    it('returns applied runtime truth before exposing pending teardown as follow-up', async () => {
        let finishStop: (() => void) | undefined;
        mocks.stopPlayback.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishStop = resolve;
            })
        );
        const result = await handleStopPlayback.execute({ type: 'stopPlayback' });

        expect(mocks.stopPlayback).toHaveBeenCalledOnce();
        expect(result?.status).toBe('written');
        if (!result?.afterRuntimeExecution) {
            throw new Error('Expected Stop teardown follow-up');
        }
        let settled = false;
        const followUp = Promise.resolve(result.afterRuntimeExecution()).then(() => {
            settled = true;
            return undefined;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        if (!finishStop) {
            throw new Error('Expected Stop teardown to remain pending');
        }
        finishStop();
        await followUp;
        expect(settled).toBe(true);
    });

    it('reports recorder teardown failure from the runtime follow-up', async () => {
        const failure = new Error('recording flush failed');
        mocks.stopPlayback.mockRejectedValueOnce(failure);

        const result = await handleStopPlayback.execute({ type: 'stopPlayback' });

        expect(result?.status).toBe('written');
        await expect(result?.afterRuntimeExecution?.()).rejects.toBe(failure);
    });
});
