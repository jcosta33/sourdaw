import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTrimClipStart } from '../handleTrimClipStart';

const mocks = vi.hoisted(() => ({
    trimClipStart: vi.fn(),
    getTrackStoreState: vi.fn<
        () => {
            tracks: {
                id: string;
                clips: {
                    id: string;
                    startBeat: number;
                    type?: 'audio' | 'midi';
                    audioOffsetSeconds?: number;
                    audioOffsetBeats?: number;
                }[];
            }[];
        } | null
    >(),
}));

vi.mock('../../../useCases/clipEditing/trimClipStart', () => ({
    trimClipStart: mocks.trimClipStart,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleTrimClipStart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes trimClipStart with the provided payload', () => {
        void handleTrimClipStart.execute({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });

        expect(mocks.trimClipStart).toHaveBeenCalledWith('c1', 2, undefined);
    });

    it('provides a description', () => {
        const desc = handleTrimClipStart.describe({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });
        expect(desc.label).toBe('Trim clip start');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse back to the pre-trim start beat', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 1 }] }],
        });

        const desc = handleTrimClipStart.describe({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 1 },
        });
    });

    it('captures the exact pre-trim audio source fields for undo, including canonical zero', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', type: 'audio', startBeat: 1, audioOffsetSeconds: 0, audioOffsetBeats: 9 }],
                },
            ],
        });

        const desc = handleTrimClipStart.describe({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'trimClipStart',
            payload: {
                clipId: 'c1',
                newStartBeat: 1,
                restoreAudioSource: { audioOffsetSeconds: 0, audioOffsetBeats: 9 },
                expectedAudioSource: { audioOffsetSeconds: 0.5, audioOffsetBeats: 1 },
            },
        });
    });

    it('refuses an inverse after a peer changed the canonical source at the same clip placement', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', type: 'audio', startBeat: 2, audioOffsetSeconds: 99, audioOffsetBeats: 2 }],
                },
            ],
        });

        expect(
            handleTrimClipStart.execute({
                type: 'trimClipStart',
                payload: {
                    clipId: 'c1',
                    newStartBeat: 1,
                    expectedAudioSource: { audioOffsetSeconds: 1, audioOffsetBeats: 2 },
                    restoreAudioSource: { audioOffsetSeconds: 0, audioOffsetBeats: 9 },
                },
            })
        ).toEqual({ status: 'conflict' });
        expect(mocks.trimClipStart).not.toHaveBeenCalled();
    });

    it('refuses a malformed source capture without reaching the project writer', () => {
        expect(
            handleTrimClipStart.execute({
                type: 'trimClipStart',
                payload: {
                    clipId: 'c1',
                    newStartBeat: 1,
                    expectedAudioSource: { audioOffsetSeconds: 0, audioOffsetBeats: 0 },
                    restoreAudioSource: { audioOffsetSeconds: Number.NaN, audioOffsetBeats: 0 },
                },
            })
        ).toEqual({ status: 'conflict' });
        expect(mocks.trimClipStart).not.toHaveBeenCalled();
    });

    it('is undoable', () => {
        expect(handleTrimClipStart.undoable).toBe(true);
    });
});
