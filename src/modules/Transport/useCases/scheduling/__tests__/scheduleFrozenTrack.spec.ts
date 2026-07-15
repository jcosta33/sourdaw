import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    createBufferSource,
    ensureTrackStrip,
    getCachedAudioBuffer,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';

import { scheduleFrozenTrack } from '../scheduleFrozenTrack';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    createBufferSource: vi.fn(),
    ensureTrackStrip: vi.fn(() => ({ preFaderTap: { connect: vi.fn() } })),
    getAudioContext: vi.fn(() => ({
        createGain: vi.fn(() => ({ connect: vi.fn() })),
    })),
    getCachedAudioBuffer: vi.fn(() => null),
    getCurrentTime: vi.fn(() => 0),
}));

describe('scheduleFrozenTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // §5 — A frozen buffer is rendered starting at the track's earliest clip
    // startBeat, so playback must be offset by that beat — not beat 0.
    it('offsets the frozen buffer by the track start beat, not beat 0 (§5)', () => {
        const start = vi.fn();
        const connect = vi.fn();
        const source = { start, connect, onended: null } as never;
        vi.mocked(createBufferSource).mockReturnValue(source);
        vi.mocked(getCachedAudioBuffer).mockReturnValue({ duration: 100 } as never);
        vi.mocked(ensureTrackStrip).mockReturnValue({ preFaderTap: { connect: vi.fn() } } as never);
        vi.mocked(getCurrentTime).mockReturnValue(0);

        const track = {
            id: 'track-frozen',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
            clips: [{ startBeat: 8 }, { startBeat: 12 }],
        };

        const scheduled = scheduleFrozenTrack(track, 0, [], 120);

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(scheduled).toBe(true);
        // earliest clip startBeat = 8; at 120bpm, 8 beats = 4 seconds.
        // Old (buggy) behaviour offset by beat 0 => start(0).
        expect(start).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledWith(4);
    });
});
