import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type HandlerExecutionResult } from '#/utils/handlerContract';

type RestoreTrackAction = {
    type: 'restoreTrack';
    payload: {
        trackId: string;
        trackIndex: number;
        batchRestoreTracks?: readonly { trackId: string; trackIndex: number }[];
    };
};

type RestoreTrackExecutionResult =
    | { status: 'written'; afterCommit: () => void | Promise<void>; afterAmbiguousCommit: () => void | Promise<void> }
    | { status: 'conflict' }
    | { status: 'no-write' };

const mocks = vi.hoisted(() => ({
    execute: vi.fn<(action: RestoreTrackAction) => RestoreTrackExecutionResult | undefined>(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../restore/handleRestoreTrack', () => ({
    handleRestoreTrack: {
        execute: mocks.execute,
    },
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

import { handleRestoreTracks } from '../restoreTracks';

// `execute` is declared as possibly async on the shared contract even though this
// handler runs synchronously — narrow before touching handler-result fields, the
// same way `restoreTracks.ts` itself narrows the delegated `handleRestoreTrack` call.
function requireSynchronousResult(
    result: void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>
): HandlerExecutionResult {
    expect(result).not.toBeInstanceOf(Promise);
    if (!result || result instanceof Promise) {
        throw new Error('expected a synchronous handler result');
    }
    return result;
}

function createRestore(trackId: string, trackIndex: number) {
    return {
        trackId,
        trackSnapshot: { id: trackId },
        trackName: trackId,
        trackKind: 'audio' as const,
        trackGain: 1,
        trackParentId: null,
        trackIndex,
        wasSelected: false,
        routingPatches: [],
        automationLaneSnapshots: [],
        clipSatellites: [],
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
        takeLaneSnapshots: [],
        sidechainRouteSnapshots: [],
        ownedModulatorSnapshots: [],
        incomingModulationMappingSnapshots: [],
    };
}

describe('handleRestoreTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
    });

    it('is not undoable', () => {
        expect(handleRestoreTracks.undoable).toBe(false);
    });

    it('describe carries no inverse action', () => {
        const desc = handleRestoreTracks.describe({
            type: 'restoreTracks',
            payload: { restores: [] },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('writes nothing for an empty restores array', () => {
        const result = handleRestoreTracks.execute({
            type: 'restoreTracks',
            payload: { restores: [] },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it('restores tracks in ascending trackIndex order regardless of payload order', () => {
        const restoreA = createRestore('a', 0);
        const restoreB = createRestore('b', 1);
        const restoreC = createRestore('c', 2);
        mocks.execute.mockReturnValue({
            status: 'written',
            afterCommit: vi.fn(),
            afterAmbiguousCommit: vi.fn(),
        });

        // Deliberately out of order — proves the handler sorts rather than trusting
        // the payload's order.
        const result = requireSynchronousResult(
            handleRestoreTracks.execute({
                type: 'restoreTracks',
                payload: { restores: [restoreC, restoreA, restoreB] },
            })
        );

        expect(result.status).toBe('written');
        expect(mocks.execute).toHaveBeenCalledTimes(3);

        const calledTrackIds = mocks.execute.mock.calls.map((call) => call[0].payload.trackId);
        expect(calledTrackIds).toEqual(['a', 'b', 'c']);

        const batchRestoreTracks = mocks.execute.mock.calls[0]![0].payload.batchRestoreTracks;
        expect(batchRestoreTracks).toEqual([
            { trackId: 'a', trackIndex: 0 },
            { trackId: 'b', trackIndex: 1 },
            { trackId: 'c', trackIndex: 2 },
        ]);
    });

    it('conflicts and writes nothing when a restored track already exists', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'b' }] });
        const restoreA = createRestore('a', 0);
        const restoreB = createRestore('b', 1);

        const result = handleRestoreTracks.execute({
            type: 'restoreTracks',
            payload: { restores: [restoreA, restoreB] },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it('conflicts when track store state is unavailable', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        const result = handleRestoreTracks.execute({
            type: 'restoreTracks',
            payload: { restores: [createRestore('a', 0)] },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it('aggregates afterCommit and afterAmbiguousCommit effects from every restore', async () => {
        const afterCommitA = vi.fn();
        const afterCommitB = vi.fn();
        const afterAmbiguousCommitA = vi.fn();
        const afterAmbiguousCommitB = vi.fn();
        mocks.execute
            .mockReturnValueOnce({
                status: 'written',
                afterCommit: afterCommitA,
                afterAmbiguousCommit: afterAmbiguousCommitA,
            })
            .mockReturnValueOnce({
                status: 'written',
                afterCommit: afterCommitB,
                afterAmbiguousCommit: afterAmbiguousCommitB,
            });

        const result = requireSynchronousResult(
            handleRestoreTracks.execute({
                type: 'restoreTracks',
                payload: { restores: [createRestore('a', 0), createRestore('b', 1)] },
            })
        );

        await result.afterCommit?.();
        expect(afterCommitA).toHaveBeenCalledOnce();
        expect(afterCommitB).toHaveBeenCalledOnce();
        expect(afterAmbiguousCommitA).not.toHaveBeenCalled();

        await result.afterAmbiguousCommit?.();
        expect(afterAmbiguousCommitA).toHaveBeenCalledOnce();
        expect(afterAmbiguousCommitB).toHaveBeenCalledOnce();
    });

    it('conflicts when a delegated restore fails after the up-front existence check passed', () => {
        mocks.execute
            .mockReturnValueOnce({ status: 'written', afterCommit: vi.fn(), afterAmbiguousCommit: vi.fn() })
            .mockReturnValueOnce({ status: 'conflict' });

        const result = handleRestoreTracks.execute({
            type: 'restoreTracks',
            payload: { restores: [createRestore('a', 0), createRestore('b', 1)] },
        });

        expect(result).toEqual({ status: 'conflict' });
    });
});
