import { describe, expect, it } from 'vitest';

import {
    describePlayStart,
    resolvePlayStart,
    type PlayStartProbe,
    type PlayStartRecord,
} from '../desktopLatencyPlayStart.ts';

describe('resolvePlayStart', () => {
    // The engine reported playing at the fourth poll (118 ms). The bracket's
    // lower edge is the *last poll before that one showed not-playing*
    // (104 ms), not the gesture's very first poll (101 ms) — the interval
    // between the gesture and that first poll proves nothing about when the
    // engine actually rolled. A trailing fifth poll (120 ms, also playing) is
    // included to prove the resolver stops counting at the first playing
    // poll rather than the last one in the array.
    it('brackets the roll lag between the last not-playing poll and the first playing poll', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            polls: [
                { atMs: 101, playing: false, positionSeconds: 0 },
                { atMs: 102.5, playing: false, positionSeconds: 0 },
                { atMs: 104, playing: false, positionSeconds: 0 },
                { atMs: 118, playing: true, positionSeconds: 0.002 },
                { atMs: 120, playing: true, positionSeconds: 0.004 },
            ],
        };

        expect(resolvePlayStart(probe)).toEqual({
            rollLagLowerMs: 4,
            rollLagUpperMs: 18,
            positionSecondsAtFirstPlaying: 0.002,
            pollCount: 4,
            pollIntervalMedianMs: 1.5,
        });
    });

    it('brackets the lag at zero when the very first poll already reports playing', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            polls: [{ atMs: 105, playing: true, positionSeconds: 0.01 }],
        };

        expect(resolvePlayStart(probe)).toEqual({
            rollLagLowerMs: 0,
            rollLagUpperMs: 5,
            positionSecondsAtFirstPlaying: 0.01,
            pollCount: 1,
            pollIntervalMedianMs: 0,
        });
    });

    it('reports not-observed when no poll ever caught the engine playing', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            polls: [
                { atMs: 101, playing: false, positionSeconds: 0 },
                { atMs: 5_100, playing: false, positionSeconds: 0 },
            ],
        };

        expect(resolvePlayStart(probe)).toEqual({
            outcome: 'not-observed',
            reason: 'the engine never reported playing within the probe window',
        });
    });

    it('reports not-observed when the play click never reached the capture listener', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: null,
            polls: [{ atMs: 101, playing: true, positionSeconds: 0.02 }],
        };

        expect(resolvePlayStart(probe)).toEqual({
            outcome: 'not-observed',
            reason: 'the play click never reached the capture listener',
        });
    });
});

describe('describePlayStart', () => {
    it('describes an observed bracket as one reportLeg-style line', () => {
        const record: PlayStartRecord = {
            rollLagLowerMs: 18.2,
            rollLagUpperMs: 19.6,
            positionSecondsAtFirstPlaying: 0,
            pollCount: 14,
            pollIntervalMedianMs: 1.3,
        };

        expect(describePlayStart(record)).toBe(
            'play start: native roll lag 18.2–19.6 ms (poll median 1.3 ms, 14 polls), engine position 0.000 s at first playing'
        );
    });

    it('describes a not-observed record with its reason', () => {
        const record: PlayStartRecord = {
            outcome: 'not-observed',
            reason: 'the engine never reported playing within the probe window',
        };

        expect(describePlayStart(record)).toBe(
            'play start: not observed — the engine never reported playing within the probe window'
        );
    });
});
