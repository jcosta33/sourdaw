import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifyUser = vi.fn();

const trackStoreMock = vi.hoisted(() => ({
    value: null as unknown,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: trackStoreMock,
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        has: vi.fn(),
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: (...args: unknown[]) => notifyUser(...args),
}));

import { type TrackStoreState } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

import { verifyAudioBufferReferences } from '../verifyAudioBufferReferences';

describe('verifyAudioBufferReferences', () => {
    beforeEach(() => {
        notifyUser.mockClear();
        vi.mocked(audioBufferCache.has).mockReset();
        trackStoreMock.value = null;
    });

    it('should not notify when track state is null', () => {
        verifyAudioBufferReferences();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('should not notify when all referenced audio buffers exist', () => {
        vi.mocked(audioBufferCache.has).mockReturnValue(true);
        trackStoreMock.value = {
            tracks: [
                {
                    clips: [{ type: 'audio', name: 'ok', audioBufferId: 'buf-1' }],
                },
            ],
        } as TrackStoreState;

        verifyAudioBufferReferences();

        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('should notify with clip names when an audio clip references a missing buffer', () => {
        vi.mocked(audioBufferCache.has).mockReturnValue(false);
        trackStoreMock.value = {
            tracks: [
                {
                    clips: [{ type: 'audio', name: 'missing-clip', audioBufferId: 'gone' }],
                },
            ],
        } as TrackStoreState;

        verifyAudioBufferReferences();

        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringMatching(/missing-clip/), 'warning');
    });

    it('should summarize when more than three clips are missing buffers', () => {
        vi.mocked(audioBufferCache.has).mockReturnValue(false);
        trackStoreMock.value = {
            tracks: [
                {
                    clips: [
                        { type: 'audio', name: 'a', audioBufferId: '1' },
                        { type: 'audio', name: 'b', audioBufferId: '2' },
                        { type: 'audio', name: 'c', audioBufferId: '3' },
                        { type: 'audio', name: 'd', audioBufferId: '4' },
                    ],
                },
            ],
        } as TrackStoreState;

        verifyAudioBufferReferences();

        expect(notifyUser).toHaveBeenCalledWith(expect.stringMatching(/and 1 more/), 'warning');
    });
});
