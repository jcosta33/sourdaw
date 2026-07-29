import { describe, expect, it } from 'vitest';

import { estimateRenderTailSeconds, type TailDeclarationLike } from '../estimateRenderTailSeconds';

/** The built-in delay's declaration: feedback 0.4 into a 250 ms loop. */
const DELAY_TAIL: TailDeclarationLike = {
    kind: 'feedbackLoop',
    feedbackParameterId: 'delay-feedback',
    defaultFeedback: 0.4,
    maxFeedback: 0.95,
    loopParameterId: 'delay-time',
    loopUnit: 'ms',
    defaultLoopSeconds: 0.25,
};

/** A plain 2 s reverb. */
const REVERB_TAIL: TailDeclarationLike = { kind: 'decaySeconds', parameterId: 'rev-decay', defaultSeconds: 2 };

/** 0.25 s per repeat, decaying to -60 dB at 0.4 feedback. */
const DELAY_SECONDS = 0.25 * (Math.log(0.001) / Math.log(0.4));
const REVERB_SECONDS = 2;

type TrackInput = {
    id: string;
    outputId?: string;
    sends?: Array<{ busId: string }>;
    tail?: TailDeclarationLike;
};

function makeTrack({ id, outputId, sends, tail }: TrackInput) {
    return {
        id,
        outputId,
        sends: sends ?? [],
        devices: tail ? [{ type: `device-${id}`, parameterValues: {}, bypassed: false, tail }] : [],
    };
}

/**
 * A track's devices are wired in series, so their tails cascade and are summed.
 * The identical cascade exists one level up and was not: a track feeding a bus
 * plays into that bus's own chain, so the bus's reverb needs its full decay to
 * resolve the *last* of the track's ringing. Scoring the two as independent
 * chains and taking the larger truncates the difference off the end of a render,
 * on exactly the send- and bus-heavy sessions that are normal in real mixes.
 */
describe('render tail across routing edges', () => {
    it('sums a track’s chain into the chain of the bus it outputs to', () => {
        const tracks = [
            makeTrack({ id: 'track-1', outputId: 'bus-1', tail: DELAY_TAIL }),
            makeTrack({ id: 'bus-1', outputId: 'master', tail: REVERB_TAIL }),
        ];

        // The delay rings for its full decay, and the bus reverb then needs its
        // own full decay to resolve that last echo.
        expect(estimateRenderTailSeconds(tracks).seconds).toBeCloseTo(DELAY_SECONDS + REVERB_SECONDS, 6);
    });

    it('sums across a send the same way it does across an output', () => {
        const tracks = [
            makeTrack({ id: 'track-1', outputId: 'master', sends: [{ busId: 'bus-1' }], tail: DELAY_TAIL }),
            makeTrack({ id: 'bus-1', outputId: 'master', tail: REVERB_TAIL }),
        ];

        expect(estimateRenderTailSeconds(tracks).seconds).toBeCloseTo(DELAY_SECONDS + REVERB_SECONDS, 6);
    });

    it('takes the longest path, not the total, when a track feeds several destinations', () => {
        // A track feeds its output *and* each of its sends at once. Those are
        // alternative paths for the same signal, so the answer is the longest of
        // them — adding them together would reserve a tail no single path needs.
        const tracks = [
            makeTrack({
                id: 'track-1',
                outputId: 'bus-quiet',
                sends: [{ busId: 'bus-long' }],
                tail: DELAY_TAIL,
            }),
            makeTrack({ id: 'bus-quiet', outputId: 'master' }),
            makeTrack({ id: 'bus-long', outputId: 'master', tail: REVERB_TAIL }),
        ];

        expect(estimateRenderTailSeconds(tracks).seconds).toBeCloseTo(DELAY_SECONDS + REVERB_SECONDS, 6);
    });

    it('accumulates along a chain of buses', () => {
        const tracks = [
            makeTrack({ id: 'track-1', outputId: 'bus-1', tail: DELAY_TAIL }),
            makeTrack({ id: 'bus-1', outputId: 'bus-2', tail: REVERB_TAIL }),
            makeTrack({ id: 'bus-2', outputId: 'master', tail: REVERB_TAIL }),
        ];

        expect(estimateRenderTailSeconds(tracks).seconds).toBeCloseTo(
            DELAY_SECONDS + REVERB_SECONDS + REVERB_SECONDS,
            6
        );
    });

    it('terminates on a routing graph that is already cyclic', () => {
        // The mutation boundary rejects cycles, but a document written before
        // that guard can still hold one, so the walk cannot assume the invariant.
        const tracks = [
            makeTrack({ id: 'bus-a', outputId: 'bus-b', tail: REVERB_TAIL }),
            makeTrack({ id: 'bus-b', outputId: 'bus-a', tail: REVERB_TAIL }),
        ];

        const estimate = estimateRenderTailSeconds(tracks);

        expect(Number.isFinite(estimate.seconds)).toBe(true);
        expect(estimate.seconds).toBeCloseTo(REVERB_SECONDS + REVERB_SECONDS, 6);
    });

    it('ignores an output that names no track in the render set', () => {
        // `outputId` can be the literal `master` with no matching track record,
        // or `hw_out`, which is never a track. Neither carries a device chain.
        const tracks = [makeTrack({ id: 'track-1', outputId: 'hw_out', tail: REVERB_TAIL })];

        expect(estimateRenderTailSeconds(tracks).seconds).toBeCloseTo(REVERB_SECONDS, 6);
    });

    it('still answers for callers that project no routing at all', () => {
        // Freeze evaluates a single chain and has no routing to give.
        const estimate = estimateRenderTailSeconds([
            { devices: [{ type: 'reverb', parameterValues: {}, bypassed: false, tail: REVERB_TAIL }] },
        ]);

        expect(estimate.seconds).toBeCloseTo(REVERB_SECONDS, 6);
    });

    it('carries a frozen track’s baked tail into the bus it feeds', () => {
        const tracks = [
            { id: 'track-1', outputId: 'bus-1', sends: [], devices: [], bakedTailSeconds: 3 },
            makeTrack({ id: 'bus-1', outputId: 'master', tail: REVERB_TAIL }),
        ];

        expect(estimateRenderTailSeconds(tracks).seconds).toBeCloseTo(3 + REVERB_SECONDS, 6);
    });
});
