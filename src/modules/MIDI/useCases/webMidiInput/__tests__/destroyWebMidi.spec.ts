import { describe, it, expect, vi, beforeEach } from 'vitest';

import { destroyWebMidi as repoTeardown } from '../../../repositories/webMidi/lifecycle/destroyWebMidi';
import { destroyWebMidi } from '../destroyWebMidi';
import { releaseNativeLiveNote } from '../releaseNativeLiveNote';

vi.mock('../../../repositories/webMidi/lifecycle/destroyWebMidi', () => ({
    destroyWebMidi: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    sendNativeLiveMidiNote: vi.fn(async () => true),
    audioEngine: {
        context: { currentTime: 0 },
        getTrackStrip: (trackId: string) => ({ trackId }),
        sendNativeLiveMidiNote: vi.fn(async () => true),
    },
}));

describe('destroyWebMidi', () => {
    beforeEach(() => {
        vi.mocked(repoTeardown).mockClear();
    });

    it('should delegate to the Web MIDI lifecycle repository', () => {
        destroyWebMidi();

        expect(repoTeardown).toHaveBeenCalledTimes(1);
    });

    it('gives the repository a strip access routed through audioEngine', () => {
        destroyWebMidi();

        const input = vi.mocked(repoTeardown).mock.calls[0]?.[0] as {
            getTrackStrip: (trackId: string) => unknown;
        };

        expect(input.getTrackStrip('track-1')).toEqual({ trackId: 'track-1' });
    });

    it('gives the repository the module-owned native-note release', () => {
        destroyWebMidi();

        const input = vi.mocked(repoTeardown).mock.calls[0]?.[0] as {
            releaseNativeNote: typeof releaseNativeLiveNote;
        };

        expect(input.releaseNativeNote).toBe(releaseNativeLiveNote);
    });
});
