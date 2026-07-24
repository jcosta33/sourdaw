import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    createBufferSource,
    ensureTrackStrip,
    getCachedAudioBuffer,
    getCompensationDelay,
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
    getCompensationDelay: vi.fn(() => 0),
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

    it('does not schedule anything when the track is not frozen', () => {
        const track = {
            id: 'track-live',
            freezeState: { status: 'live' },
            clips: [{ startBeat: 0 }],
        };

        const scheduled = scheduleFrozenTrack(track, 0, [], 120);

        expect(scheduled).toBe(false);
        expect(getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(createBufferSource).not.toHaveBeenCalled();
    });

    it('does not schedule anything when the frozen buffer is not cached', () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        const track = {
            id: 'track-frozen',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-missing' },
            clips: [{ startBeat: 0 }],
        };

        const scheduled = scheduleFrozenTrack(track, 0, [], 120);

        expect(scheduled).toBe(false);
        expect(createBufferSource).not.toHaveBeenCalled();
    });

    it('starts the buffer mid-way through when playback has already begun before the current tick', () => {
        const start = vi.fn();
        const source = { start, connect: vi.fn(), onended: null } as never;
        vi.mocked(createBufferSource).mockReturnValue(source);
        vi.mocked(getCachedAudioBuffer).mockReturnValue({ duration: 100 } as never);
        vi.mocked(ensureTrackStrip).mockReturnValue({ preFaderTap: { connect: vi.fn() } } as never);
        vi.mocked(getCurrentTime).mockReturnValue(0);

        const track = {
            id: 'track-frozen',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
            clips: [{ startBeat: 0 }],
        };
        const activeAudioSources: AudioBufferSourceNode[] = [];

        // trackStartBeat 0, accumulatedPosition 2 beats, tempo 120bpm (2 beats/sec)
        // => beatOffset -2 beats => -1 second: playback is already 1s in when this
        // tick fires, so it must start the source at an offset instead of at time 0.
        const scheduled = scheduleFrozenTrack(track, 2, activeAudioSources, 120);

        expect(scheduled).toBe(true);
        expect(start).toHaveBeenCalledWith(0, 1);
        expect(activeAudioSources).toContain(source);
    });

    it('does not start a buffer whose already-elapsed offset has outlasted its duration', () => {
        const start = vi.fn();
        const source = { start, connect: vi.fn(), onended: null } as never;
        vi.mocked(createBufferSource).mockReturnValue(source);
        vi.mocked(getCachedAudioBuffer).mockReturnValue({ duration: 0.5 } as never);
        vi.mocked(ensureTrackStrip).mockReturnValue({ preFaderTap: { connect: vi.fn() } } as never);
        vi.mocked(getCurrentTime).mockReturnValue(0);

        const track = {
            id: 'track-frozen',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
            clips: [{ startBeat: 0 }],
        };
        const activeAudioSources: AudioBufferSourceNode[] = [];

        const scheduled = scheduleFrozenTrack(track, 2, activeAudioSources, 120);

        expect(scheduled).toBe(true);
        expect(start).not.toHaveBeenCalled();
        expect(activeAudioSources).toHaveLength(0);
    });

    it('removes the source from the active pool once its playback ends', () => {
        const start = vi.fn();
        const source = { start, connect: vi.fn(), onended: null as (() => void) | null };
        vi.mocked(createBufferSource).mockReturnValue(source as never);
        vi.mocked(getCachedAudioBuffer).mockReturnValue({ duration: 100 } as never);
        vi.mocked(ensureTrackStrip).mockReturnValue({ preFaderTap: { connect: vi.fn() } } as never);
        vi.mocked(getCurrentTime).mockReturnValue(0);

        const track = {
            id: 'track-frozen',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
            clips: [{ startBeat: 0 }],
        };
        const otherSource = { start: vi.fn() } as never;
        const activeAudioSources: AudioBufferSourceNode[] = [otherSource];

        scheduleFrozenTrack(track, 0, activeAudioSources, 120);
        expect(activeAudioSources).toContain(source as never);

        source.onended?.();

        expect(activeAudioSources).not.toContain(source as never);
        expect(activeAudioSources).toEqual([otherSource]);
    });

    // FX-4 — every other live source path (scheduleAudioClips, scheduleMidiNotes,
    // applyAutomation) shifts by getCompensationDelay; the frozen buffer path was
    // the one that did not, so a frozen track flammed against the whole session.
    it('pushes the frozen buffer back by the track compensation delay (FX-4)', () => {
        const start = vi.fn();
        const source = { start, connect: vi.fn(), onended: null } as never;
        vi.mocked(createBufferSource).mockReturnValue(source);
        vi.mocked(getCachedAudioBuffer).mockReturnValue({ duration: 100 } as never);
        vi.mocked(ensureTrackStrip).mockReturnValue({ preFaderTap: { connect: vi.fn() } } as never);
        vi.mocked(getCurrentTime).mockReturnValue(0);
        vi.mocked(getCompensationDelay).mockReturnValue(0.02);

        const track = {
            id: 'track-frozen',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
            clips: [{ startBeat: 8 }],
        };

        const scheduled = scheduleFrozenTrack(track, 0, [], 120);

        expect(scheduled).toBe(true);
        expect(getCompensationDelay).toHaveBeenCalledWith('track-frozen');
        // 8 beats at 120bpm = 4s, plus the track's 20ms compensation.
        expect(start).toHaveBeenCalledWith(4.02);
    });

    it('keeps the compensation on the already-elapsed branch', () => {
        const start = vi.fn();
        const source = { start, connect: vi.fn(), onended: null } as never;
        vi.mocked(createBufferSource).mockReturnValue(source);
        vi.mocked(getCachedAudioBuffer).mockReturnValue({ duration: 100 } as never);
        vi.mocked(ensureTrackStrip).mockReturnValue({ preFaderTap: { connect: vi.fn() } } as never);
        vi.mocked(getCurrentTime).mockReturnValue(0);
        vi.mocked(getCompensationDelay).mockReturnValue(0.02);

        const track = {
            id: 'track-frozen',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
            clips: [{ startBeat: 0 }],
        };

        // beatOffset −2 beats = −1s, so the compensated start is −0.98s: the
        // buffer must resume 0.98s in, not the uncompensated 1s.
        const scheduled = scheduleFrozenTrack(track, 2, [], 120);

        expect(scheduled).toBe(true);
        expect(start).toHaveBeenCalledWith(0, 0.98);
    });
});
