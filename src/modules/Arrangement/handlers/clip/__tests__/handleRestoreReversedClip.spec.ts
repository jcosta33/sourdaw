import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Knead/useCases', () => ({
    restoreClipPitchAnalysis: vi.fn(),
}));

vi.mock('../../../stores/updateClipInStore', () => ({
    updateClipInStore: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

import { restoreClipPitchAnalysis } from '#/modules/Knead/useCases';

import { updateClipInStore } from '../../../stores/updateClipInStore';
import { getTrackStoreState } from '../../../useCases/getTrackStoreState';
import { handleRestoreReversedClip } from '../handleRestoreReversedClip';

const mockedGetState = vi.mocked(getTrackStoreState);
const mockedUpdateClip = vi.mocked(updateClipInStore);
const mockedRestoreAnalysis = vi.mocked(restoreClipPitchAnalysis);

type ClipUnderTest = {
    id: string;
    type: 'audio';
    audioBufferId: string;
    name: string;
    fadeInBeats: number;
    fadeOutBeats: number;
};

function setClip(clip: ClipUnderTest): void {
    mockedGetState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip] }] } as never);
}

function publishedUpdate(candidate: ClipUnderTest): ClipUnderTest {
    const updater = mockedUpdateClip.mock.calls[0]?.[1];
    if (!updater) {
        throw new Error('expected updateClipInStore to receive an updater');
    }
    return updater(candidate);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleRestoreReversedClip', () => {
    it('restores the fades carried by the payload alongside buffer and name', () => {
        const reversedClip: ClipUnderTest = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'reversed-1',
            name: 'Verse (reversed)',
            fadeInBeats: 1.5,
            fadeOutBeats: 0.25,
        };
        setClip(reversedClip);

        const result = handleRestoreReversedClip.execute({
            type: 'restoreReversedClip',
            payload: {
                clipId: 'c1',
                expectedAudioBufferId: 'reversed-1',
                audioBufferId: 'buffer-1',
                name: 'Verse',
                fadeInBeats: 0.25,
                fadeOutBeats: 1.5,
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(publishedUpdate(reversedClip)).toMatchObject({
            audioBufferId: 'buffer-1',
            name: 'Verse',
            fadeInBeats: 0.25,
            fadeOutBeats: 1.5,
        });
    });

    it('leaves fades untouched on a legacy payload that predates the fade fields', () => {
        const reversedClip: ClipUnderTest = {
            id: 'c1',
            type: 'audio',
            audioBufferId: 'reversed-1',
            name: 'Verse (reversed)',
            fadeInBeats: 1.5,
            fadeOutBeats: 0.25,
        };
        setClip(reversedClip);

        const result = handleRestoreReversedClip.execute({
            type: 'restoreReversedClip',
            payload: {
                clipId: 'c1',
                expectedAudioBufferId: 'reversed-1',
                audioBufferId: 'buffer-1',
                name: 'Verse',
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(publishedUpdate(reversedClip)).toMatchObject({ fadeInBeats: 1.5, fadeOutBeats: 0.25 });
    });

    it('conflicts without writing when the expected buffer is no longer current', () => {
        setClip({
            id: 'c1',
            type: 'audio',
            audioBufferId: 'someone-else',
            name: 'Verse (reversed)',
            fadeInBeats: 1.5,
            fadeOutBeats: 0.25,
        });

        const result = handleRestoreReversedClip.execute({
            type: 'restoreReversedClip',
            payload: {
                clipId: 'c1',
                expectedAudioBufferId: 'reversed-1',
                audioBufferId: 'buffer-1',
                name: 'Verse',
                fadeInBeats: 0.25,
                fadeOutBeats: 1.5,
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mockedUpdateClip).not.toHaveBeenCalled();
        expect(mockedRestoreAnalysis).not.toHaveBeenCalled();
    });
});
