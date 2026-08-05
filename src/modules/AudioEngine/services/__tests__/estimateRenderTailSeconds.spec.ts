import { describe, it, expect } from 'vitest';

import { estimateRenderTailSeconds, MAX_AUTO_TAIL_SECONDS } from '../estimateRenderTailSeconds';

const REVERB_TAIL = { kind: 'decaySeconds', parameterId: 'rev-decay', defaultSeconds: 2 } as const;

const DELAY_TAIL = {
    kind: 'feedbackLoop',
    feedbackParameterId: 'delay-feedback',
    defaultFeedback: 0.4,
    maxFeedback: 0.95,
    loopParameterId: 'delay-time',
    loopUnit: 'ms',
    defaultLoopSeconds: 0.25,
} as const;

describe('estimateRenderTailSeconds', () => {
    it('returns 0 when no device declares a tail', () => {
        const result = estimateRenderTailSeconds([
            { devices: [{ type: 'builtin-eq', parameterValues: {}, bypassed: false }] },
        ]);
        expect(result.seconds).toBe(0);
    });

    it('reads a decay parameter as seconds', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-reverb',
                        parameterValues: { 'rev-decay': 4.5 },
                        bypassed: false,
                        tail: REVERB_TAIL,
                    },
                ],
            },
        ]);
        expect(result.seconds).toBe(4.5);
    });

    it('adds a declared pre-delay to the decay time', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-reverb',
                        parameterValues: { 'rev-decay': 3, 'rev-predelay': 200 },
                        bypassed: false,
                        tail: {
                            kind: 'decaySeconds',
                            parameterId: 'rev-decay',
                            defaultSeconds: 2,
                            predelayMsParameterId: 'rev-predelay',
                        },
                    },
                ],
            },
        ]);
        expect(result.seconds).toBe(3.2);
    });

    it('falls back to the declared default when the parameter is missing', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-reverb',
                        parameterValues: {},
                        bypassed: false,
                        tail: { kind: 'decaySeconds', parameterId: 'rev-decay', defaultSeconds: 2.5 },
                    },
                ],
            },
        ]);
        expect(result.seconds).toBe(2.5);
    });

    it('uses a declared fixed tail verbatim', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-convolution-reverb',
                        parameterValues: {},
                        bypassed: false,
                        tail: { kind: 'fixed', seconds: 6 },
                    },
                ],
            },
        ]);
        expect(result.seconds).toBe(6);
    });

    it('ignores bypassed devices', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-reverb',
                        parameterValues: { 'rev-decay': 8 },
                        bypassed: true,
                        tail: REVERB_TAIL,
                    },
                ],
            },
        ]);
        expect(result.seconds).toBe(0);
    });

    it('picks the longest tail across tracks', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    { type: 'builtin-reverb', parameterValues: { 'rev-decay': 2 }, bypassed: false, tail: REVERB_TAIL },
                ],
            },
            {
                devices: [
                    { type: 'builtin-reverb', parameterValues: { 'rev-decay': 6 }, bypassed: false, tail: REVERB_TAIL },
                ],
            },
        ]);
        expect(result.seconds).toBe(6);
    });

    it('decays a millisecond feedback loop to -60 dB', () => {
        // 500 ms at 0.5 feedback halves every repeat, so reaching -60 dB (a
        // factor of 1000) takes just under 10 repeats: ~4.98 s.
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-delay',
                        parameterValues: { 'delay-time': 500, 'delay-feedback': 0.5 },
                        bypassed: false,
                        tail: DELAY_TAIL,
                    },
                ],
            },
        ]);
        expect(result.seconds).toBeCloseTo(4.983, 3);
    });

    it('reads a feedback loop whose time parameter is already in seconds', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'faust-tape-delay',
                        parameterValues: { delay: 0.5, feedback: 0.5 },
                        bypassed: false,
                        tail: {
                            kind: 'feedbackLoop',
                            feedbackParameterId: 'feedback',
                            defaultFeedback: 0.5,
                            maxFeedback: 0.95,
                            loopParameterId: 'delay',
                            loopUnit: 's',
                            defaultLoopSeconds: 0.3,
                        },
                    },
                ],
            },
        ]);
        // Same loop length and feedback as the millisecond case, so the unit
        // conversion has to land on the same tail rather than 1000x it.
        expect(result.seconds).toBeCloseTo(4.983, 3);
    });

    it('clamps feedback to the declared maximum so a runaway loop stays finite', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-delay',
                        parameterValues: { 'delay-time': 100, 'delay-feedback': 1 },
                        bypassed: false,
                        tail: DELAY_TAIL,
                    },
                ],
            },
        ]);
        // Clamped to 0.95: at unity the loop never decays and the formula would
        // divide by ln(1) = 0.
        // 0.1 s * ln(0.001)/ln(0.95) = 0.1 * 134.672
        expect(result.seconds).toBeCloseTo(13.467, 3);
        expect(Number.isFinite(result.seconds)).toBe(true);
    });

    it('ignores a feedback loop with zero feedback', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-delay',
                        parameterValues: { 'delay-time': 500, 'delay-feedback': 0 },
                        bypassed: false,
                        tail: DELAY_TAIL,
                    },
                ],
            },
        ]);
        expect(result.seconds).toBe(0);
    });

    it('sums tails within a track and takes the longest track', () => {
        const chained = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-reverb',
                        parameterValues: { 'rev-decay': 3 },
                        bypassed: false,
                        tail: { kind: 'fixed', seconds: 3 },
                    },
                    {
                        type: 'builtin-convolution-reverb',
                        parameterValues: {},
                        bypassed: false,
                        tail: { kind: 'fixed', seconds: 4 },
                    },
                ],
            },
            {
                devices: [
                    {
                        type: 'builtin-reverb',
                        parameterValues: {},
                        bypassed: false,
                        tail: { kind: 'fixed', seconds: 5 },
                    },
                ],
            },
        ]);

        // Track 1 cascades 3 s into 4 s, so it needs 7 s — more than the 5 s of
        // the longest single device anywhere in the project.
        expect(chained.seconds).toBe(7);
    });

    it('excludes a bypassed device from the chain total', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    { type: 'a', parameterValues: {}, bypassed: false, tail: { kind: 'fixed', seconds: 3 } },
                    { type: 'b', parameterValues: {}, bypassed: true, tail: { kind: 'fixed', seconds: 4 } },
                ],
            },
        ]);

        expect(result.seconds).toBe(3);
    });

    it('caps a very long tail at the auto-detect ceiling', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'builtin-reverb',
                        parameterValues: { 'rev-decay': 100 },
                        bypassed: false,
                        tail: REVERB_TAIL,
                    },
                ],
            },
        ]);
        expect(result.seconds).toBe(MAX_AUTO_TAIL_SECONDS);
        // The previous ceiling clipped long reverbs at 30 s.
        expect(MAX_AUTO_TAIL_SECONDS).toBeGreaterThan(30);
    });

    it('takes the longest enabled tail declared from opaque device state', () => {
        const result = estimateRenderTailSeconds([
            {
                devices: [
                    {
                        type: 'stateful-drum-machine',
                        parameterValues: {},
                        deviceState: {
                            data: {
                                kit: {
                                    reverbMix: 0,
                                    reverbDecay: 0.8,
                                    delayMix: 1,
                                    delayTime: 2_000,
                                    delayFeedback: 0.95,
                                },
                            },
                        },
                        bypassed: false,
                        tail: {
                            kind: 'parallel',
                            tails: [
                                {
                                    kind: 'stateFeedbackLoop',
                                    feedbackPath: ['data', 'kit', 'reverbDecay'],
                                    defaultFeedback: 0.5,
                                    maxFeedback: 0.99,
                                    loopUnit: 's',
                                    defaultLoopSeconds: 0.041,
                                    enabledPath: ['data', 'kit', 'reverbMix'],
                                    defaultEnabledValue: 0.15,
                                },
                                {
                                    kind: 'stateFeedbackLoop',
                                    feedbackPath: ['data', 'kit', 'delayFeedback'],
                                    defaultFeedback: 0.35,
                                    maxFeedback: 0.95,
                                    loopPath: ['data', 'kit', 'delayTime'],
                                    loopUnit: 'ms',
                                    defaultLoopSeconds: 0.375,
                                    enabledPath: ['data', 'kit', 'delayMix'],
                                    defaultEnabledValue: 0,
                                },
                            ],
                        },
                    },
                ],
            },
        ]);

        expect(result.seconds).toBe(MAX_AUTO_TAIL_SECONDS);
        expect(result.clamped).toBe(true);
    });
});
