import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDiscardDuplicatedClip } from '../handleDiscardDuplicatedClip';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    removeClip: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/clip/removeClip', () => ({
    removeClip: mocks.removeClip,
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
});
