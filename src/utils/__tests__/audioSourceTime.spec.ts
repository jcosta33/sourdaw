import { describe, expect, it } from 'vitest';

import {
    getAudioSourcePositionSeconds,
    getAudioTimelineElapsedSeconds,
    resolveAudioSourceOffsetSeconds,
} from '../audioSourceTime';

describe('resolveAudioSourceOffsetSeconds', () => {
    it('prefers canonical zero over a nonzero legacy offset', () => {
        expect(resolveAudioSourceOffsetSeconds({ audioOffsetSeconds: 0, audioOffsetBeats: 12 }, 90)).toBe(0);
    });

    it('keeps a signed canonical entry independent of the legacy offset and tempo', () => {
        const offset = { audioOffsetSeconds: -2, audioOffsetBeats: 12 };
        expect(resolveAudioSourceOffsetSeconds(offset, 90)).toBe(-2);
        expect(resolveAudioSourceOffsetSeconds(offset, 60)).toBe(-2);
    });

    it.each([
        { tempo: 90, beats: 3, seconds: 2 },
        { tempo: 60, beats: 3, seconds: 3 },
        { tempo: 90, beats: -3, seconds: -2 },
    ])('reads legacy $beats beats at the clip-start tempo $tempo', ({ tempo, beats, seconds }) => {
        expect(resolveAudioSourceOffsetSeconds({ audioOffsetBeats: beats }, tempo)).toBe(seconds);
    });

    it('defaults a missing offset to source sample zero', () => {
        expect(resolveAudioSourceOffsetSeconds({}, 90)).toBe(0);
    });

    it('preserves a finite legacy offset when seconds per beat is one', () => {
        expect(resolveAudioSourceOffsetSeconds({ audioOffsetBeats: Number.MAX_VALUE }, 60)).toBe(Number.MAX_VALUE);
    });

    it.each([0, -60, Number.NaN, Number.POSITIVE_INFINITY])(
        'preserves the legacy no-offset fallback for an invalid clip-start tempo %s',
        (tempo) => {
            expect(resolveAudioSourceOffsetSeconds({ audioOffsetBeats: 3 }, tempo)).toBe(0);
        }
    );
});

describe('audio source and timeline seconds', () => {
    it('retains signed source positions across silent lead-in at double speed', () => {
        expect(getAudioSourcePositionSeconds(-2, 0, 2)).toBe(-2);
        expect(getAudioSourcePositionSeconds(-2, 0.5, 2)).toBe(-1);
        expect(getAudioTimelineElapsedSeconds(-2, 0, 2)).toBe(1);
        expect(getAudioSourcePositionSeconds(-2, 1, 2)).toBe(0);
    });

    it('advances source time over a caller-integrated internal tempo change', () => {
        // Beats 8..14 at 120 BPM take 3 seconds; beats 14..16 at 60 take 2.
        const elapsedTimelineSeconds = 5;
        const sourcePositionSeconds = getAudioSourcePositionSeconds(1.25, elapsedTimelineSeconds, 1.5);
        expect(sourcePositionSeconds).toBe(8.75);
        expect(sourcePositionSeconds - getAudioSourcePositionSeconds(1.25, 0, 1.5)).toBe(7.5);
        expect(getAudioTimelineElapsedSeconds(1.25, sourcePositionSeconds, 1.5)).toBe(5);
    });

    it('preserves a reversed elapsed span rather than clamping it', () => {
        // The same tempo-map interval traversed from beat 16 back to beat 8.
        const sourcePositionSeconds = getAudioSourcePositionSeconds(1.25, -5, 1.5);
        expect(sourcePositionSeconds).toBe(-6.25);
        expect(getAudioTimelineElapsedSeconds(1.25, sourcePositionSeconds, 1.5)).toBe(-5);
    });

    it.each([
        { ratio: 0, sourcePosition: 1.04 },
        { ratio: -2, sourcePosition: 1.04 },
        { ratio: 2, sourcePosition: 9 },
        { ratio: 1000, sourcePosition: 401 },
    ])('uses the shared stretch bound for forward and inverse ratio $ratio', ({ ratio, sourcePosition }) => {
        expect(getAudioSourcePositionSeconds(1, 4, ratio)).toBeCloseTo(sourcePosition, 12);
        expect(getAudioTimelineElapsedSeconds(1, sourcePosition, ratio)).toBeCloseTo(4, 12);
    });
});
