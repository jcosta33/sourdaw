import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDiscardDuplicatedClip } from '../handleDiscardDuplicatedClip';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    removeClip: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
    restoreTakesForClip: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/clip/removeClip', () => ({
    removeClip: mocks.removeClip,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

vi.mock('../../../useCases/comping/restoreTakesForClip', () => ({
    restoreTakesForClip: mocks.restoreTakesForClip,
}));

describe('handleDiscardDuplicatedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
    });

    it('should remove the duplicated clip directly', () => {
        void handleDiscardDuplicatedClip.execute({
            type: 'discardDuplicatedClip',
            payload: { clipId: 'clip-copy' },
        });

        expect(mocks.removeClip).toHaveBeenCalledWith('clip-copy');
    });

    it('rejects a guarded discard when the generated clip was edited', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-copy', name: 'edited' }] }],
        });
        const result = await handleDiscardDuplicatedClip.execute({
            type: 'discardDuplicatedClip',
            payload: {
                clipId: 'clip-copy',
                generatedMidiStateGuard: {
                    entityJson: JSON.stringify({ id: 'clip-copy', name: 'original' }),
                    midiByClipIdJson: JSON.stringify({}),
                },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.removeClip).not.toHaveBeenCalled();
    });

    it('should provide an internal inverse description', () => {
        const desc = handleDiscardDuplicatedClip.describe({
            type: 'discardDuplicatedClip',
            payload: { clipId: 'clip-copy' },
        });

        expect(desc).toEqual({ label: 'Discard duplicated clip' });
    });

    it('should not create a new undo entry', () => {
        expect(handleDiscardDuplicatedClip.undoable).toBe(false);
    });

    it('does not restore the capture when the clip it names is absent', () => {
        const retiredTakeLanes = [
            {
                laneIndex: 0,
                lane: { id: 'lane-1', trackId: 'track-1', takes: [], activeCompRegions: [] },
            },
        ];
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'missing' });

        handleDiscardDuplicatedClip.afterRedoReplay?.({
            type: 'discardDuplicatedClip',
            payload: { clipId: 'clip-copy', retiredTakeLanes },
        });

        // The redo re-created nothing, so the capture has no clip to come back to and
        // must not reach the restore at all.
        expect(mocks.restoreTakesForClip).not.toHaveBeenCalled();
    });

    it('restores the capture once the clip it names is back', () => {
        const retiredTakeLanes = [
            {
                laneIndex: 0,
                lane: { id: 'lane-1', trackId: 'track-1', takes: [], activeCompRegions: [] },
            },
        ];
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'clip-copy',
        });

        handleDiscardDuplicatedClip.afterRedoReplay?.({
            type: 'discardDuplicatedClip',
            payload: { clipId: 'clip-copy', retiredTakeLanes },
        });

        expect(mocks.restoreTakesForClip).toHaveBeenCalledExactlyOnceWith(retiredTakeLanes);
    });

    it('preserves the creator prefix guard when the whole group has replayed', () => {
        const recorded = { entityJson: '{"id":"clip-copy","v":1}', midiByClipIdJson: '{"v":1}' };
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'clip-copy',
        });
        const inverse = {
            type: 'discardDuplicatedClip' as const,
            payload: { clipId: 'clip-copy', generatedMidiStateGuard: recorded },
        };

        handleDiscardDuplicatedClip.afterRedoReplay?.(inverse);

        expect(inverse.payload.generatedMidiStateGuard).toBe(recorded);
    });

    it('leaves an unguarded inverse unguarded after a redo', () => {
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'clip-copy',
        });
        const inverse: { type: 'discardDuplicatedClip'; payload: { clipId: string } } = {
            type: 'discardDuplicatedClip',
            payload: { clipId: 'clip-copy' },
        };

        handleDiscardDuplicatedClip.afterRedoReplay?.(inverse);

        expect(inverse.payload).toEqual({ clipId: 'clip-copy' });
    });

    it('keeps the recorded guard when the redo re-created nothing', () => {
        const recorded = { entityJson: '{}', midiByClipIdJson: '{}' };
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'missing' });
        const inverse = {
            type: 'discardDuplicatedClip' as const,
            payload: { clipId: 'clip-copy', generatedMidiStateGuard: recorded },
        };

        handleDiscardDuplicatedClip.afterRedoReplay?.(inverse);

        expect(inverse.payload.generatedMidiStateGuard).toBe(recorded);
    });
});
