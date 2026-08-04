import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSeekPlayhead } from '../handleSeekPlayhead';

const mocks = vi.hoisted(() => ({
    executePlayheadSeek: vi.fn<(beat: number) => Promise<void>>(),
    transportState: null as { playheadPosition: number } | null,
}));

vi.mock('../../../useCases/transportControls/executePlayheadSeek', () => ({
    executePlayheadSeek: mocks.executePlayheadSeek,
}));

vi.mock('../../../stores/transportStore', () => ({
    transportStore: {
        get value() {
            return mocks.transportState;
        },
    },
}));

describe('handleSeekPlayhead', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transportState = { playheadPosition: 4 };
    });

    it('classifies playhead seeks as non-undoable runtime commands', () => {
        expect(handleSeekPlayhead.executionKind).toBe('runtime');
        expect(handleSeekPlayhead.undoable).toBe(false);
    });

    it('rejects a missing transport or live playhead no-op before runtime execution', () => {
        expect(handleSeekPlayhead.isNoop?.({ type: 'seekPlayhead', payload: { beat: 4 } })).toBe(true);

        mocks.transportState = null;
        expect(handleSeekPlayhead.isNoop?.({ type: 'seekPlayhead', payload: { beat: 8 } })).toBe(true);

        mocks.transportState = { playheadPosition: 4 };
        expect(handleSeekPlayhead.isNoop?.({ type: 'seekPlayhead', payload: { beat: 8 } })).toBe(false);
    });

    it('exposes seek settlement as a runtime follow-up', async () => {
        let finishSeek: (() => void) | undefined;
        mocks.executePlayheadSeek.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishSeek = resolve;
            })
        );

        const result = handleSeekPlayhead.execute({ type: 'seekPlayhead', payload: { beat: 16 } });

        expect(mocks.executePlayheadSeek).toHaveBeenCalledWith(16);
        if (!result || result instanceof Promise || !result.afterRuntimeExecution) {
            throw new Error('Expected a written seek result with runtime completion');
        }
        expect(result.status).toBe('written');
        let settled = false;
        const followUp = Promise.resolve(result.afterRuntimeExecution()).then(() => {
            settled = true;
            return undefined;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        if (!finishSeek) {
            throw new Error('Expected playhead seek to remain pending');
        }
        finishSeek();
        await followUp;
        expect(settled).toBe(true);
    });

    it('propagates seek settlement failures to the runtime receipt', async () => {
        const failure = new Error('recording flush failed');
        mocks.executePlayheadSeek.mockRejectedValueOnce(failure);

        const result = handleSeekPlayhead.execute({ type: 'seekPlayhead', payload: { beat: 16 } });

        if (!result || result instanceof Promise) {
            throw new Error('Expected a written seek result');
        }
        await expect(result.afterRuntimeExecution?.()).rejects.toBe(failure);
    });
});
