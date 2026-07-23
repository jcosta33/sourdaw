import { describe, expect, it } from 'vitest';

import {
    ppqToSamples,
    projectPpqToSamples,
    projectSamplesToPpq,
    rateToBeats,
    samplesToBeats,
    type TransportInfo,
} from '../MidiEvent';

const transport: TransportInfo = {
    isPlaying: true,
    ppqPosition: 0,
    bpm: 120,
    sampleRate: 44100,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

describe('ppqToSamples / samplesToBeats', () => {
    it('converts PPQ to samples using the transport tempo', () => {
        // 120bpm @ 44100Hz -> 22050 samples/beat.
        expect(ppqToSamples(2, transport)).toBe(44100);
    });

    it('round-trips samples back to the originating beat count', () => {
        const samples = ppqToSamples(3, transport);
        expect(samplesToBeats(samples, transport)).toBe(3);
    });
});

describe('rateToBeats', () => {
    it('computes straight, dotted and triplet durations from the same denominator', () => {
        expect(rateToBeats({ type: 'straight', denom: 8 })).toBe(0.5);
        expect(rateToBeats({ type: 'dotted', denom: 8 })).toBe(0.75);
        expect(rateToBeats({ type: 'triplet', denom: 8 })).toBeCloseTo((4 / 8) * (2 / 3), 10);
    });
});

describe('projectPpqToSamples', () => {
    it('falls back to the flat samplesPerBeat projection when no tempo map is present', () => {
        expect(projectPpqToSamples(2, transport)).toBe(44100);
    });

    it('returns zero for a zero-length projection against a tempo map', () => {
        const withTempoMap: TransportInfo = {
            ...transport,
            tempoMap: { defaultTempo: 120, changes: [{ beat: 2, tempo: 150, curve: 'instant' }] },
        };
        expect(projectPpqToSamples(0, withTempoMap)).toBe(0);
    });

    it('projects a negative PPQ to a negative sample offset', () => {
        const withTempoMap: TransportInfo = {
            ...transport,
            tempoMap: { defaultTempo: 120, changes: [{ beat: 2, tempo: 150, curve: 'instant' }] },
        };
        expect(projectPpqToSamples(-2, withTempoMap)).toBeLessThan(0);
    });

    it('uses the first change tempo for a query point that precedes it', () => {
        // Querying before the only change means tempoAtPpq's "previous" is undefined,
        // so it falls back to that change's tempo (150bpm) rather than defaultTempo.
        const withTempoMap: TransportInfo = {
            ...transport,
            tempoMap: { defaultTempo: 100, changes: [{ beat: 2, tempo: 150, curve: 'instant' }] },
        };
        // 1 beat @ 150bpm = 0.4s -> 0.4 * 44100 = 17640 samples exactly.
        expect(projectPpqToSamples(1, withTempoMap)).toBe(17640);
    });

    it('accumulates duration across multiple instant tempo changes', () => {
        const withTempoMap: TransportInfo = {
            ...transport,
            tempoMap: {
                defaultTempo: 60,
                changes: [
                    { beat: 2, tempo: 120, curve: 'instant' },
                    { beat: 4, tempo: 240, curve: 'instant' },
                ],
            },
        };
        // [0,2) @120bpm=1s, [2,4) @120bpm=1s, [4,6) @240bpm=0.5s -> 2.5s * 44100 = 110250 samples.
        expect(projectPpqToSamples(6, withTempoMap)).toBe(110250);
    });

    it('inverts tempo-map samples relative to a live processing block anchor', () => {
        const anchored: TransportInfo = {
            ...transport,
            sampleRate: 48_000,
            ppqPosition: 4,
            blockStartSamples: 1_000_000,
            tempoMap: { defaultTempo: 60, changes: [{ beat: 4, tempo: 120, curve: 'instant' }] },
        };
        expect(projectSamplesToPpq(1_024_000, anchored)).toBe(5);
    });

    it('interpolates duration across a linear tempo ramp using the log-mean formula', () => {
        const withTempoMap: TransportInfo = {
            ...transport,
            tempoMap: {
                defaultTempo: 100,
                changes: [
                    { beat: 0, tempo: 100, curve: 'linear' },
                    { beat: 8, tempo: 200, curve: 'linear' },
                ],
            },
        };
        const queryPpq = 4;
        const startTempo = 100;
        // Independently derived tempo at the query point (halfway through the ramp).
        const endTempo = 100 + (200 - 100) * (queryPpq / 8);
        // Closed-form integral of dt/tempo(beat) for a linear tempo ramp between two points.
        const expectedSeconds = (queryPpq * 60 * Math.log(endTempo / startTempo)) / (endTempo - startTempo);

        expect(projectPpqToSamples(queryPpq, withTempoMap)).toBe(Math.round(expectedSeconds * transport.sampleRate));
    });
});
