import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSlipClipContent } from '../handleSlipClipContent';

const mocks = vi.hoisted(() => ({
    slipClipContent: vi.fn(),
    getTrackStoreState: vi.fn<
        () => {
            tracks: {
                id: string;
                clips: { id: string; type: 'audio' | 'midi'; audioOffsetBeats?: number; midiOffsetBeats?: number }[];
            }[];
        } | null
    >(),
}));

vi.mock('../../../useCases/clipEditing/slipClipContent', () => ({
    slipClipContent: mocks.slipClipContent,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSlipClipContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes slipClipContent with the provided payload', () => {
        void handleSlipClipContent.execute({
            type: 'slipClipContent',
            payload: { clipId: 'c1', clipType: 'audio', offset: 1.5 },
        });

        expect(mocks.slipClipContent).toHaveBeenCalledWith('c1', 'audio', 1.5);
    });

    it('provides a description with no inverse when the clip is gone', () => {
        const desc = handleSlipClipContent.describe({
            type: 'slipClipContent',
            payload: { clipId: 'c1', clipType: 'audio', offset: 1.5 },
        });
        expect(desc.label).toBe('Slip clip content');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse back to the pre-slip audio offset', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'audio', audioOffsetBeats: -2 }] }],
        });

        const desc = handleSlipClipContent.describe({
            type: 'slipClipContent',
            payload: { clipId: 'c1', clipType: 'audio', offset: 1.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'slipClipContent',
            payload: { clipId: 'c1', clipType: 'audio', offset: -2 },
        });
    });

    it('falls back to offset 0 for the inverse when the clip never carried a midi offset', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'cm', type: 'midi' }] }],
        });

        const desc = handleSlipClipContent.describe({
            type: 'slipClipContent',
            payload: { clipId: 'cm', clipType: 'midi', offset: 1 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'slipClipContent',
            payload: { clipId: 'cm', clipType: 'midi', offset: 0 },
        });
    });

    it('is undoable', () => {
        expect(handleSlipClipContent.undoable).toBe(true);
    });
});
