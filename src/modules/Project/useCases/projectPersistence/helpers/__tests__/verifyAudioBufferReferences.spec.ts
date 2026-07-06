import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifyUser = vi.fn();

const trackStoreMock = vi.hoisted(() => ({
    value: null as unknown,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: trackStoreMock,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: (...args: unknown[]) => notifyUser(...args),
}));

import { type TrackStoreState } from '#/modules/Arrangement/stores';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { verifyAudioBufferReferences } from '../verifyAudioBufferReferences';

describe('verifyAudioBufferReferences', () => {
    beforeEach(() => {
        notifyUser.mockClear();
        vi.mocked(getCachedAudioBuffer).mockReset();
        trackStoreMock.value = null;
    });

    it('should not notify when track state is null', () => {
        verifyAudioBufferReferences();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('should not notify when all referenced audio buffers exist', () => {
        const cached_buffer: AudioBuffer = {
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
            duration: 1,
            getChannelData: vi.fn(() => new Float32Array(1)),
            length: 1,
            numberOfChannels: 1,
            sampleRate: 48000,
        };
        vi.mocked(getCachedAudioBuffer).mockReturnValue(cached_buffer);
        trackStoreMock.value = {
            tracks: [
                {
                    freezeState: { status: 'unfrozen' },
                    clips: [{ type: 'audio', name: 'ok', audioBufferId: 'buf-1' }],
                },
            ],
        } as TrackStoreState;

        verifyAudioBufferReferences();

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('should notify with clip names when an audio clip references a missing buffer', () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        trackStoreMock.value = {
            tracks: [
                {
                    freezeState: { status: 'unfrozen' },
                    clips: [{ type: 'audio', name: 'missing-clip', audioBufferId: 'gone' }],
                },
            ],
        } as TrackStoreState;

        verifyAudioBufferReferences();

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'gone' });
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringMatching(/missing-clip/), 'warning');
    });

    it('should notify with frozen track names when a frozen track references a missing buffer', () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        trackStoreMock.value = {
            tracks: [
                {
                    name: 'Frozen Piano',
                    freezeState: { status: 'frozen', frozenBufferId: 'frozen-gone' },
                    clips: [],
                },
            ],
        } as TrackStoreState;

        verifyAudioBufferReferences();

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'frozen-gone' });
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringMatching(/Frozen track Frozen Piano/), 'warning');
    });

    it('should summarize when more than three clips are missing buffers', () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        trackStoreMock.value = {
            tracks: [
                {
                    freezeState: { status: 'unfrozen' },
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
