import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip } from '#/modules/Arrangement/stores';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE } from '#/utils/clipLoopOrigin';

import { limitClipEndToSource } from '../limitClipEndToSource';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => { length: number; sampleRate: number } | null>(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

/** A decoded source of `seconds` length under the buffer id every fixture clip names. */
function cacheSource(seconds: number, sampleRate = 48_000): void {
    mocks.getCachedAudioBuffer.mockImplementation(({ bufferId }) =>
        bufferId === 'buffer-1' ? { length: seconds * sampleRate, sampleRate } : null
    );
}

function audioClip(fields: Partial<Clip>): Clip {
    return {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Take',
        type: 'audio',
        audioBufferId: 'buffer-1',
        startBeat: 2,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...fields,
    };
}

/**
 * 120 BPM until beat 8, then 60 BPM. A clip at beat 2 entering its 4 s source
 * 1 beat (0.5 s) in has 3.5 s left: 3 s to beat 8, then 0.5 s, so its source
 * runs out on beat 8.5. A flat 120 BPM conversion would put that on beat 9.
 */
describe('limitClipEndToSource keeps a non-looping audio clip within its source', () => {
    let previousTransport: typeof transportStore.value;
    let previousTempoMap: typeof tempoMapStore.value;

    beforeEach(() => {
        previousTransport = transportStore.value;
        previousTempoMap = tempoMapStore.value;
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-8', beat: 8, tempo: 60, curve: 'instant' },
            ],
        });
        mocks.getCachedAudioBuffer.mockReset();
        cacheSource(4);
    });

    afterEach(() => {
        transportStore.set(previousTransport);
        tempoMapStore.set(previousTempoMap);
    });

    it('stops a lengthened end at the beat its source runs out, through the tempo map', () => {
        expect(limitClipEndToSource(audioClip({ audioOffsetBeats: 1 }), 12)).toBeCloseTo(8.5, 9);
    });

    it('reads a legacy beat offset at the tempo where the clip starts, not where it ends', () => {
        // The 1-beat offset is 0.5 s at the start's 120 BPM, leaving 5.5 s of a 6 s source:
        // 3 s to beat 8, then 2.5 s at 60 BPM. Read at the end's 60 BPM it would be 1 s, ending on beat 10.
        cacheSource(6);

        expect(limitClipEndToSource(audioClip({ audioOffsetBeats: 1, endBeat: 9 }), 12)).toBeCloseTo(10.5, 9);
    });

    it('reads a canonical seconds entry and the stretch rate the clip consumes its source at', () => {
        // 1 s into a 4 s source at twice the rate: 3 s of source last 1.5 s, three beats at 120 BPM.
        const clip = audioClip({
            startBeat: 0,
            endBeat: 2,
            audioOffsetSeconds: 1,
            stretchMode: 'timestretch',
            stretchRatio: 2,
        });

        expect(limitClipEndToSource(clip, 6)).toBeCloseTo(3, 9);
    });

    it('reads the source length at its own sample rate', () => {
        // The same 4 s source decoded at 44.1 kHz still runs out on beat 8.5.
        cacheSource(4, 44_100);

        expect(limitClipEndToSource(audioClip({ audioOffsetBeats: 1 }), 12)).toBeCloseTo(8.5, 9);
    });

    it('counts the silence a negative entry plays before the source begins', () => {
        // One second of pre-roll, then the 2 s source: six beats at 120 BPM.
        cacheSource(2);

        expect(limitClipEndToSource(audioClip({ startBeat: 0, endBeat: 2, audioOffsetSeconds: -1 }), 7)).toBeCloseTo(
            6,
            9
        );
    });

    it('keeps a requested end within the tolerance past the source end', () => {
        // 1 s into a 4 s source from beat 0 ends on beat 6 exactly.
        const requestedEndBeat = 6 + CLIP_LOOP_WINDOW_BEAT_TOLERANCE / 2;

        expect(
            limitClipEndToSource(audioClip({ startBeat: 0, endBeat: 2, audioOffsetSeconds: 1 }), requestedEndBeat)
        ).toBe(requestedEndBeat);
    });

    const unclampedCases = [
        {
            name: 'a looping audio clip extends past its source',
            clip: audioClip({ audioOffsetBeats: 1, loopEnabled: true }),
            requestedEndBeat: 12,
        },
        {
            name: 'a MIDI clip is not bounded by any source',
            clip: audioClip({ type: 'midi', audioBufferId: undefined }),
            requestedEndBeat: 12,
        },
        {
            name: 'a MIDI clip that still names a buffer id is not bounded by it',
            clip: audioClip({ type: 'midi', audioOffsetBeats: 1 }),
            requestedEndBeat: 12,
        },
        {
            name: 'a shortened clip takes the requested end',
            clip: audioClip({ audioOffsetBeats: 1, endBeat: 8 }),
            requestedEndBeat: 3,
        },
        {
            name: 'a clip already past its source end still shortens to the requested end',
            clip: audioClip({ audioOffsetBeats: 1, endBeat: 10 }),
            requestedEndBeat: 9,
        },
        {
            name: 'a lengthened end the source still covers is kept as requested',
            clip: audioClip({ audioOffsetBeats: 1 }),
            requestedEndBeat: 6,
        },
        {
            name: 'a lengthened end exactly on the source end is kept as requested',
            clip: audioClip({ startBeat: 0, endBeat: 2, audioOffsetSeconds: 1 }),
            requestedEndBeat: 6,
        },
        {
            name: 'an audio clip without a buffer id keeps the requested end',
            clip: audioClip({ audioOffsetBeats: 1, audioBufferId: undefined }),
            requestedEndBeat: 12,
        },
    ];

    it.each(unclampedCases)('$name', ({ clip, requestedEndBeat }) => {
        expect(limitClipEndToSource(clip, requestedEndBeat)).toBe(requestedEndBeat);
    });

    it('keeps the requested end when the decoded source is not cached', () => {
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        expect(limitClipEndToSource(audioClip({ audioOffsetBeats: 1 }), 12)).toBe(12);
    });

    it('does not lengthen a clip that already ends past its source', () => {
        expect(limitClipEndToSource(audioClip({ audioOffsetBeats: 1, endBeat: 10 }), 12)).toBe(10);
    });
});
