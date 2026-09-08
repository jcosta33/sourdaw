import { describe, expect, it } from 'vitest';

import {
    describePlayStart,
    resolvePlayStart,
    type PlayStartProbe,
    type PlayStartRecord,
} from '../desktopLatencyPlayStart.ts';

describe('resolvePlayStart', () => {
    // The engine reported playing at the third poll (answered 118 ms). The
    // lower edge is built from the *previous* poll's issued time (102.5 ms)
    // minus one callback period (2 ms) minus the gesture — not from the first
    // playing poll's own timestamp — because a not-playing answer only proves
    // the engine was not rolling at the last callback boundary before the
    // poll that asked. The upper edge subtracts the rendered position
    // (0.006 s → 6 ms) from the first playing poll's answered time, because
    // the engine cannot have rendered 6 ms of audio in less than 6 ms of wall
    // time.
    it('brackets the roll lag by the callback period on the lower edge and the rendered position on the upper edge', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 2,
            polls: [
                { issuedAtMs: 101, answeredAtMs: 102.5, playing: false, positionSeconds: 0 },
                { issuedAtMs: 102.5, answeredAtMs: 104, playing: false, positionSeconds: 0 },
                { issuedAtMs: 104, answeredAtMs: 118, playing: true, positionSeconds: 0.006 },
            ],
        };

        expect(resolvePlayStart(probe)).toEqual({
            rollLagLowerMs: 0.5,
            rollLagUpperMs: 12,
            positionSecondsAtFirstPlaying: 0.006,
            callbackPeriodMs: 2,
            pollCount: 3,
            pollIntervalMedianMs: 1.5,
        });
    });

    it('clamps the lower edge at zero when the last not-playing poll precedes the gesture', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 2,
            polls: [
                { issuedAtMs: 99, answeredAtMs: 100.5, playing: false, positionSeconds: 0 },
                { issuedAtMs: 100.5, answeredAtMs: 102, playing: true, positionSeconds: 0.001 },
            ],
        };

        expect(resolvePlayStart(probe)).toEqual({
            rollLagLowerMs: 0,
            rollLagUpperMs: 1,
            positionSecondsAtFirstPlaying: 0.001,
            callbackPeriodMs: 2,
            pollCount: 2,
            pollIntervalMedianMs: 1.5,
        });
    });

    it('brackets the lag at zero on both edges when the very first poll already reports playing', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 2,
            polls: [{ issuedAtMs: 101, answeredAtMs: 103, playing: true, positionSeconds: 0.5 }],
        };

        expect(resolvePlayStart(probe)).toEqual({
            rollLagLowerMs: 0,
            rollLagUpperMs: 3,
            positionSecondsAtFirstPlaying: 0.5,
            callbackPeriodMs: 2,
            pollCount: 1,
            pollIntervalMedianMs: 0,
        });
    });

    it('reports not-observed when the engine published no callback period', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 0,
            polls: [
                { issuedAtMs: 101, answeredAtMs: 102.5, playing: false, positionSeconds: 0 },
                { issuedAtMs: 102.5, answeredAtMs: 104, playing: false, positionSeconds: 0 },
                { issuedAtMs: 104, answeredAtMs: 118, playing: true, positionSeconds: 0.006 },
            ],
        };

        expect(resolvePlayStart(probe)).toEqual({
            outcome: 'not-observed',
            reason: 'the engine published no callback period',
        });
    });

    it('reports not-observed when no poll ever caught the engine playing', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 2,
            polls: [
                { issuedAtMs: 101, answeredAtMs: 101.5, playing: false, positionSeconds: 0 },
                { issuedAtMs: 5_100, answeredAtMs: 5_100.5, playing: false, positionSeconds: 0 },
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
            callbackPeriodMs: 2,
            polls: [{ issuedAtMs: 101, answeredAtMs: 101.5, playing: true, positionSeconds: 0.02 }],
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
            rollLagLowerMs: 0.5,
            rollLagUpperMs: 12,
            positionSecondsAtFirstPlaying: 0.006,
            callbackPeriodMs: 2,
            pollCount: 3,
            pollIntervalMedianMs: 1.5,
        };

        expect(describePlayStart(record)).toBe(
            'play start: native roll lag 0.5–12.0 ms (callback 2.0 ms, poll median 1.5 ms, 3 polls), engine position 0.006 s at first playing'
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
