import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureGestureBeat, captureGestureClock } from '../captureGestureBeat';
import { type GestureClockSource } from '../gestureClockSource';
import { holdPlayheadClock, playheadClockRef, releasePlayheadClockHold } from '../playheadClockRef';
import { playheadPositionRef } from '../playheadPositionRef';
import { tempoMapStore } from '../tempoMapStore';
import { defaultTransportState, transportStore } from '../transportStore';

const mocks = vi.hoisted(() => ({
    source: null as GestureClockSource | null,
}));

vi.mock('../gestureClockSource', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../gestureClockSource')>()),
    getGestureClockSource: () => mocks.source,
}));

/**
 * The beat a gesture captured *now* happened at (#3799).
 *
 * The store's `playheadPosition` is written on discrete transitions only, so
 * during playback it holds the beat playback started at; the rAF ref is a
 * latest-value channel published after a tick's awaited work. Neither may
 * timestamp a gesture. What may is the projection of the scheduler's committed
 * anchor over the audio clock — evaluated at the event — and, while the native
 * engine is the audible transport, the engine's own cursor.
 */
describe('captureGestureBeat', () => {
    beforeEach(() => {
        // Playback began at beat 2 (nonzero start) and the scheduler has
        // committed anchor beat 2 as of audio time 10. The store and the rAF
        // ref both still read the start beat: only the audio clock moves in the
        // fixtures below, so a green result cannot come from either stale
        // channel.
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 2 });
        tempoMapStore.set({ changes: [] });
        playheadClockRef.beat = 2;
        playheadClockRef.audioTimeSeconds = 10;
        playheadClockRef.hold = null;
        playheadClockRef.pendingLoopSeam = null;
        playheadPositionRef.current = 2;
        mocks.source = {
            getAudioTimeSeconds: () => 10,
            readNativeCursorBeats: () => null,
        };
    });

    it.each([
        'current',
        'equivalent map',
        'generation',
        'anchor',
        'time',
        'tempo',
        'map',
        'region',
        'hold',
        'native',
        'no source',
    ] as const)('pairs one carrier read with only its current scheduled seam: %s', (change) => {
        transportStore.set({ ...transportStore.value!, isLooping: true, loopStart: 0, loopEnd: 4 });
        const readNativeCursorBeats = vi.fn(() => (change === 'native' ? 0.5 : null));
        mocks.source = { getAudioTimeSeconds: () => 10.06, readNativeCursorBeats };
        playheadClockRef.pendingLoopSeam = {
            generation: playheadClockRef.generation,
            anchorBeat: 2,
            anchorAudioTimeSeconds: 10,
            tempo: 120,
            tempoMapChanges: tempoMapStore.value?.changes ?? null,
            audioTimeSeconds: 11,
            loopStart: 0,
            loopEnd: 4,
            passIndex: 1,
        };
        const expected = playheadClockRef.pendingLoopSeam;
        if (change === 'generation') {
            playheadClockRef.generation += 1;
        }
        if (change === 'anchor') {
            playheadClockRef.beat = 2.01;
        }
        if (change === 'time') {
            playheadClockRef.audioTimeSeconds = 10.01;
        }
        if (change === 'tempo') {
            transportStore.set({ ...transportStore.value!, tempo: 121 });
        }
        if (change === 'map') {
            tempoMapStore.set({ changes: [{ id: 'edited', beat: 0, tempo: 140, curve: 'instant' }] });
        }
        if (change === 'equivalent map') {
            tempoMapStore.set({ changes: [] });
        }
        if (change === 'region') {
            transportStore.set({ ...transportStore.value!, loopEnd: 3 });
        }
        if (change === 'hold') {
            holdPlayheadClock(12, 7.5);
        }
        if (change === 'no source') {
            mocks.source = null;
        }
        const capture = captureGestureClock();
        expect(capture.pendingLoopSeam).toBe(change === 'current' || change === 'equivalent map' ? expected : null);
        expect(readNativeCursorBeats).toHaveBeenCalledTimes(change === 'hold' || change === 'no source' ? 0 : 1);
        if (change === 'hold') {
            expect(playheadClockRef.pendingLoopSeam).toBeNull();
        }
        if (change === 'native') {
            expect(capture.beat).toBe(0.5);
        }
    });

    it('answers from the discrete store while the transport is parked', () => {
        transportStore.set({ ...transportStore.value!, isPlaying: false, playheadPosition: 7.5 });

        expect(captureGestureBeat()).toBe(7.5);
    });

    it('holds the requested beat while browser admission owns the clock', () => {
        holdPlayheadClock(12, 7.5);
        mocks.source = { getAudioTimeSeconds: () => 100, readNativeCursorBeats: () => 99 };
        expect(captureGestureBeat()).toBe(7.5);
        expect(playheadClockRef.beat).toBe(2);
        expect(playheadClockRef.audioTimeSeconds).toBe(10);
    });

    it('does not let an outgoing generation release a newer hold', () => {
        holdPlayheadClock(12, 4);
        holdPlayheadClock(13, 8);
        releasePlayheadClockHold(12);
        expect(captureGestureBeat()).toBe(8);
        releasePlayheadClockHold(13);
        expect(playheadClockRef.hold).toBeNull();
        expect(captureGestureBeat()).toBe(2);
    });

    it('keeps a future admitted anchor at its beat until audio reaches it', () => {
        playheadClockRef.audioTimeSeconds = 10.1;
        mocks.source = { getAudioTimeSeconds: () => 10.05, readNativeCursorBeats: () => null };
        expect(captureGestureBeat()).toBe(2);
    });

    it('degrades to the committed anchor beat when no clock source is registered', () => {
        // Outside an initialized app (a spec that never ran the bootstrap)
        // there is no audio-clock read; the last committed scheduler position —
        // still a moving, tick-fresh value — is the answer, never the start
        // beat the store holds.
        mocks.source = null;

        expect(captureGestureBeat()).toBe(2);
    });

    it('projects the audio clock while the store still holds the playback-start beat', () => {
        // 60 ms of audio at 120 BPM = 0.12 beats past the anchor.
        mocks.source = {
            getAudioTimeSeconds: () => 10.06,
            readNativeCursorBeats: () => null,
        };

        expect(captureGestureBeat()).toBeCloseTo(2.12, 9);
    });

    it('stays at the committed anchor when no audio time has elapsed', () => {
        expect(captureGestureBeat()).toBe(2);
    });

    it('projects over the whole audio time a main-thread stall left since the anchor', () => {
        // No tick ran for 0.5 s while the audio kept playing: the gesture
        // happened 1 beat past the anchor at 120 BPM, where the next tick will
        // put the playhead, not one grain past it.
        mocks.source = {
            getAudioTimeSeconds: () => 10.5,
            readNativeCursorBeats: () => null,
        };

        expect(captureGestureBeat()).toBeCloseTo(3, 9);
    });

    it('prefers the native engine cursor while that engine is the audible transport', () => {
        // Beat 10.5 — far from anything the anchor holds, so only the engine
        // read can produce it.
        mocks.source = {
            getAudioTimeSeconds: () => 10,
            readNativeCursorBeats: () => 10.5,
        };

        expect(captureGestureBeat()).toBe(10.5);
    });

    it('projects through a tempo-map segment at the tempo in force there', () => {
        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-1', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        playheadClockRef.beat = 4.5;
        playheadClockRef.audioTimeSeconds = 10;
        mocks.source = {
            getAudioTimeSeconds: () => 10.06,
            readNativeCursorBeats: () => null,
        };

        // 60 ms at 60 BPM is 0.06 beats.
        expect(captureGestureBeat()).toBeCloseTo(4.56, 9);
    });

    it('continues forward from a wrapped position instead of assuming monotonic time', () => {
        // The playhead just wrapped a 0..4 loop and landed at the overshoot
        // 0.4; a capture 50 ms later must be 0.5, not 4.1 nor the pre-wrap 4.05.
        playheadClockRef.beat = 0.4;
        playheadClockRef.audioTimeSeconds = 10;
        mocks.source = {
            getAudioTimeSeconds: () => 10.05,
            readNativeCursorBeats: () => null,
        };

        const beat = captureGestureBeat();
        expect(beat).toBeCloseTo(0.5, 9);
        expect(beat).toBeLessThan(4);
    });
});
