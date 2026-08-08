import { beforeEach, describe, expect, it, vi } from 'vitest';

import { moveClip } from '../../../useCases/clip/moveClip';
import { handleMoveClip } from '../handleMoveClip';

type TestClip = { id: string; trackId: string; name: string; startBeat: number; endBeat: number; gain: number };
type TestTrackState = { tracks: { id: string; clips: TestClip[] }[] };

const mocks = vi.hoisted(() => ({
    getClipAutomationMoveState: vi.fn(),
    getTrackStoreState: vi.fn<() => TestTrackState | null>(),
    moveClip: vi.fn<() => boolean>(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getClipAutomationMoveState: mocks.getClipAutomationMoveState,
}));

vi.mock('../../../useCases/clip/moveClip', () => ({
    moveClip: mocks.moveClip,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('clipHandlers', () => {
    beforeEach(() => {
        mocks.getClipAutomationMoveState.mockReturnValue({ previous: [], next: [] });
    });
    it('handleMoveClip forwards to moveClip use case', () => {
        mocks.moveClip.mockReturnValueOnce(true);

        expect(
            handleMoveClip.execute({
                type: 'moveClip',
                payload: { clipId: 'c1', trackId: 't1', startBeat: 4 },
            })
        ).toEqual({ status: 'written' });

        expect(moveClip).toHaveBeenCalledWith('c1', 't1', 4);
    });

    it('reports no-write when the move use case rejects the request', () => {
        mocks.moveClip.mockReturnValueOnce(false);

        expect(
            handleMoveClip.execute({
                type: 'moveClip',
                payload: { clipId: 'missing', trackId: 't1', startBeat: 4 },
            })
        ).toEqual({ status: 'no-write' });
    });

    it('handleMoveClip describes an inverse back to the pre-move position', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't0',
                    clips: [{ id: 'c1', trackId: 't0', name: 'Clip c1', startBeat: 2, endBeat: 6, gain: 1 }],
                },
            ],
        });

        const desc = handleMoveClip.describe({
            type: 'moveClip',
            payload: { clipId: 'c1', trackId: 't1', startBeat: 4 },
        });

        expect(desc).toEqual({
            label: 'Move clip "Clip c1" (c1) to track t1 at beat 4',
            inverseAction: {
                type: 'restoreClipPlacement',
                payload: {
                    clipId: 'c1',
                    expected: { trackId: 't1', startBeat: 4, endBeat: 8, automationLanes: [] },
                    replacement: { trackId: 't0', startBeat: 2, endBeat: 6, automationLanes: [] },
                },
            },
            redoAction: {
                type: 'restoreClipPlacement',
                payload: {
                    clipId: 'c1',
                    expected: { trackId: 't0', startBeat: 2, endBeat: 6, automationLanes: [] },
                    replacement: { trackId: 't1', startBeat: 4, endBeat: 8, automationLanes: [] },
                },
            },
        });
    });

    it('handleMoveClip describes a null inverse when the clip is not found', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        const desc = handleMoveClip.describe({
            type: 'moveClip',
            payload: { clipId: 'missing', trackId: 't1', startBeat: 4 },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('detects an exact no-op and disables duplicate CRDT compensation', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't0',
                    clips: [{ id: 'c1', trackId: 't0', name: 'Clip c1', startBeat: 2, endBeat: 6, gain: 1 }],
                },
            ],
        });

        expect(
            handleMoveClip.isNoop?.({
                type: 'moveClip',
                payload: { clipId: 'c1', trackId: 't0', startBeat: 2 },
            })
        ).toBe(true);
        expect(handleMoveClip.requiresAbortCompensation).toBe(false);
        expect(handleMoveClip.undoable).toBe(true);
    });
});
