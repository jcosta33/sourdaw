import { describe, expect, it } from 'vitest';

import { resolveBouncedClipEndBeat } from '../resolveBouncedClipEndBeat';

function createBuffer(lengthSamples: number, sampleRate = 48_000): AudioBuffer {
    const channelData = new Float32Array(lengthSamples);
    return {
        copyFromChannel: () => {},
        copyToChannel: () => {},
        duration: lengthSamples / sampleRate,
        getChannelData: () => channelData,
        length: lengthSamples,
        numberOfChannels: 1,
        sampleRate,
    };
}

/** Flat 120 BPM: one beat is half a second, both directions. */
const FLAT_120 = {
    timelineSecondsAtBeat: (beat: number) => beat * 0.5,
    projectSampleToBeat: (input: { samples: number; sampleRate: number }) => input.samples / (0.5 * input.sampleRate),
};

describe('resolveBouncedClipEndBeat', () => {
    it('extends the clip across the captured decay the buffer holds', () => {
        // The #3691 shape: beats 0-4 at 120 BPM (2 seconds of music), an insert
        // decay that keeps the buffer audible for 5 seconds.
        const endBeat = resolveBouncedClipEndBeat({
            startBeat: 0,
            musicalEndBeat: 4,
            renderedBuffer: createBuffer(5 * 48_000),
            ...FLAT_120,
        });

        expect(endBeat).toBeCloseTo(10, 6);
    });

    it('maps the buffer duration from a nonzero region start through the tempo map', () => {
        // Region [8, 12] is 2 seconds of music (beats 8-12 at 120 BPM); the
        // buffer holds those 2 seconds plus 1 second of decay. Its last frame
        // lands at timeline second 7, which the inverse map reads as beat 14.
        const endBeat = resolveBouncedClipEndBeat({
            startBeat: 8,
            musicalEndBeat: 12,
            renderedBuffer: createBuffer(3 * 48_000),
            ...FLAT_120,
        });

        expect(endBeat).toBeCloseTo(14, 6);
    });

    it('follows a tempo change between the region and the tail', () => {
        // 120 BPM up to beat 4, 60 BPM afterwards: the 2 seconds of music end
        // at beat 4 (timeline second 2), and the 1 extra buffer second crosses
        // one more beat at the slower rate, ending at timeline second 3 = beat 5.
        const tempoChangeAtBeat4 = {
            timelineSecondsAtBeat: (beat: number) => (beat <= 4 ? beat * 0.5 : 2 + (beat - 4)),
            projectSampleToBeat: (input: { samples: number; sampleRate: number }) => {
                const targetSeconds = input.samples / input.sampleRate;
                return targetSeconds <= 2 ? targetSeconds / 0.5 : 4 + (targetSeconds - 2);
            },
        };

        const endBeat = resolveBouncedClipEndBeat({
            startBeat: 0,
            musicalEndBeat: 4,
            renderedBuffer: createBuffer(3 * 48_000),
            ...tempoChangeAtBeat4,
        });

        expect(endBeat).toBeCloseTo(5, 6);
    });

    it('never shortens the clip below the musical content the bounce replaced', () => {
        // A sub-threshold tail trimmed away can end the buffer before the
        // musical span does; the clip still covers the span it stands in for.
        const endBeat = resolveBouncedClipEndBeat({
            startBeat: 0,
            musicalEndBeat: 4,
            renderedBuffer: createBuffer(0.5 * 48_000),
            ...FLAT_120,
        });

        expect(endBeat).toBe(4);
    });
});
