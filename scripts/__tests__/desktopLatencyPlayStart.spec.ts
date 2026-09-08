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
    // poll that asked. The upper edge is the first playing poll's own
    // answered time minus the gesture: a `playing:true` answer received at T
    // proves the roll began no later than T.
    it('brackets the roll lag by the callback period on the lower edge and the received-at time on the upper edge', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 2,
            failure: null,
            polls: [
                { issuedAtMs: 101, answeredAtMs: 102.5, playing: false, positionSeconds: 0 },
                { issuedAtMs: 102.5, answeredAtMs: 104, playing: false, positionSeconds: 0 },
                { issuedAtMs: 104, answeredAtMs: 118, playing: true, positionSeconds: 0.006 },
            ],
        };

        expect(resolvePlayStart(probe)).toEqual({
            rollLagLowerMs: 0.5,
            rollLagUpperMs: 18,
            positionSecondsAtFirstPlaying: 0.006,
            callbackPeriodMs: 2,
            pollCount: 3,
            pollIntervalMedianMs: 1.5,
        });
    });

    // The play gesture carries a locate: `startNativeSessionAtBeat` sends
    // `positionSeconds` with the play itself, and the same graph batch that
    // flips `is_playing` also applies a `SeekFrames`. A project whose
    // playhead rests at 30 s therefore reports 30.004 s of "position" at the
    // first playing poll, even though the engine only just started rolling —
    // using that position to tighten the upper edge would put it deep in the
    // negatives. The upper edge ignores it entirely.
    it('the upper edge ignores the position the locate moved the playhead to', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 2,
            failure: null,
            polls: [
                { issuedAtMs: 101, answeredAtMs: 102, playing: false, positionSeconds: 0 },
                { issuedAtMs: 102, answeredAtMs: 104, playing: true, positionSeconds: 30.004 },
            ],
        };

        expect(resolvePlayStart(probe)).toEqual({
            rollLagLowerMs: 0,
            rollLagUpperMs: 4,
            positionSecondsAtFirstPlaying: 30.004,
            callbackPeriodMs: 2,
            pollCount: 2,
            pollIntervalMedianMs: 1,
        });
    });

    // Issue-stamp gaps are 0.5, 3, 1, 6 ms. The median of an even-length
    // sample averages the two middle values once sorted (0.5, 1, 3, 6 → (1 +
    // 3) / 2 = 2), which is why this fixture is worth its own case: the mean
    // of the same four gaps is 2.625, and picking either the first (0.5) or
    // the last (6) sorted gap would also produce a wrong, but plausible,
    // number. Only the true median is 2.
    it('the poll interval is the median of the issue-stamp gaps', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 1,
            failure: null,
            polls: [
                { issuedAtMs: 100.5, answeredAtMs: 100.9, playing: false, positionSeconds: 0 },
                { issuedAtMs: 101, answeredAtMs: 101.4, playing: false, positionSeconds: 0 },
                { issuedAtMs: 104, answeredAtMs: 104.4, playing: false, positionSeconds: 0 },
                { issuedAtMs: 105, answeredAtMs: 105.4, playing: false, positionSeconds: 0 },
                { issuedAtMs: 111, answeredAtMs: 111.4, playing: true, positionSeconds: 0.01 },
            ],
        };

        const record = resolvePlayStart(probe);
        if ('outcome' in record) {
            throw new Error('expected an observed record');
        }
        // `rollLagUpperMs` is asserted with `toBeCloseTo` rather than folded
        // into the `toEqual` below: 111.4 − 100 lands on 11.400000000000006 in
        // IEEE 754 double arithmetic, a float-precision artifact of the
        // `answeredAtMs` fixture values rather than anything `resolvePlayStart`
        // gets wrong.
        expect(record.rollLagUpperMs).toBeCloseTo(11.4, 10);
        expect({ ...record, rollLagUpperMs: undefined }).toEqual({
            rollLagLowerMs: 4,
            rollLagUpperMs: undefined,
            positionSecondsAtFirstPlaying: 0.01,
            callbackPeriodMs: 1,
            pollCount: 5,
            pollIntervalMedianMs: 2,
        });
    });

    it('clamps the lower edge at zero when the last not-playing poll precedes the gesture', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 2,
            failure: null,
            polls: [
                { issuedAtMs: 99, answeredAtMs: 100.5, playing: false, positionSeconds: 0 },
                { issuedAtMs: 100.5, answeredAtMs: 102, playing: true, positionSeconds: 0.001 },
            ],
        };

        expect(resolvePlayStart(probe)).toEqual({
            rollLagLowerMs: 0,
            rollLagUpperMs: 2,
            positionSecondsAtFirstPlaying: 0.001,
            callbackPeriodMs: 2,
            pollCount: 2,
            pollIntervalMedianMs: 1.5,
        });
    });

    it('brackets the lag at zero on the lower edge when the very first poll already reports playing', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 2,
            failure: null,
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

    it('the poll interval median takes the middle gap of an odd count', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 1,
            failure: null,
            polls: [
                { issuedAtMs: 100.5, answeredAtMs: 100.9, playing: false, positionSeconds: 0 },
                { issuedAtMs: 101.5, answeredAtMs: 101.9, playing: false, positionSeconds: 0 },
                { issuedAtMs: 106.5, answeredAtMs: 106.9, playing: false, positionSeconds: 0 },
                { issuedAtMs: 108.5, answeredAtMs: 108.9, playing: true, positionSeconds: 0.01 },
            ],
        };

        const record = resolvePlayStart(probe);
        if ('outcome' in record) {
            throw new Error('expected an observed record');
        }
        expect(record.rollLagUpperMs).toBeCloseTo(8.9, 10);
        expect({ ...record, rollLagUpperMs: undefined }).toEqual({
            rollLagLowerMs: 5.5,
            rollLagUpperMs: undefined,
            positionSecondsAtFirstPlaying: 0.01,
            callbackPeriodMs: 1,
            pollCount: 4,
            pollIntervalMedianMs: 2,
        });
    });

    it('polls after the first playing one are not counted', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 2,
            failure: null,
            polls: [
                { issuedAtMs: 101, answeredAtMs: 102, playing: false, positionSeconds: 0 },
                { issuedAtMs: 102, answeredAtMs: 104, playing: true, positionSeconds: 0.002 },
                { issuedAtMs: 104, answeredAtMs: 106, playing: false, positionSeconds: 0.004 },
                { issuedAtMs: 106, answeredAtMs: 108, playing: false, positionSeconds: 0.006 },
            ],
        };

        expect(resolvePlayStart(probe)).toEqual({
            rollLagLowerMs: 0,
            rollLagUpperMs: 4,
            positionSecondsAtFirstPlaying: 0.002,
            callbackPeriodMs: 2,
            pollCount: 2,
            pollIntervalMedianMs: 1,
        });
    });

    it('reports not-observed when the engine published no callback period', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: 100,
            callbackPeriodMs: 0,
            failure: null,
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
            failure: null,
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
            failure: null,
            polls: [{ issuedAtMs: 101, answeredAtMs: 101.5, playing: true, positionSeconds: 0.02 }],
        };

        expect(resolvePlayStart(probe)).toEqual({
            outcome: 'not-observed',
            reason: 'the play click never reached the capture listener',
        });
    });

    // `gestureAtMs` is null here too, so the fixture only distinguishes the
    // two checks if `failure` is read before `gestureAtMs`: reversing that
    // order would report "the play click never reached the capture listener"
    // instead of the probe's own failure reason.
    it('reports not-observed with the probe failure when the in-page loop threw', () => {
        const probe: PlayStartProbe = {
            gestureAtMs: null,
            callbackPeriodMs: 0,
            failure: 'engine_transport_position did not answer with an object',
            polls: [],
        };

        expect(resolvePlayStart(probe)).toEqual({
            outcome: 'not-observed',
            reason: 'the probe failed: engine_transport_position did not answer with an object',
        });
    });
});

describe('describePlayStart', () => {
    it('describes an observed bracket as one reportLeg-style line', () => {
        const record: PlayStartRecord = {
            rollLagLowerMs: 0.5,
            rollLagUpperMs: 18,
            positionSecondsAtFirstPlaying: 0.006,
            callbackPeriodMs: 2,
            pollCount: 3,
            pollIntervalMedianMs: 1.5,
        };

        expect(describePlayStart(record)).toBe(
            'play start: native roll lag 0.5–18.0 ms (callback 2.0 ms, poll median 1.5 ms, 3 polls), engine position 0.006 s at first playing'
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
