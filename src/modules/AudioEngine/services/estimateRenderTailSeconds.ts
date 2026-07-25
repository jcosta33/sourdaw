/**
 * Longest declared render tail across a project, in seconds.
 *
 * This used to be a hardcoded switch over `builtin-reverb` and
 * `builtin-delay`, which gave every other tail-producing device a tail of zero:
 * the ProofChamber reverb, the Faust reverbs and delays, the convolution
 * reverb, and every instrument release stage were all truncated on export even
 * with auto-detect enabled. Devices now declare their own tail (see
 * `DeviceTailDeclaration` in Arrangement's models) and this service only
 * evaluates the declaration, so adding a device no longer means editing the
 * export path.
 *
 * The declaration types are mirrored structurally rather than imported: this is
 * a pure service and models are never re-exported across modules. A conformance
 * spec pins this mirror against the real descriptors so the two cannot drift.
 */

/** Decay to -60 dB, the standard reverb-tail convention. */
const MINUS_60_DB = 0.001;

/**
 * Ceiling on an auto-detected tail. A declaration can produce an arbitrarily
 * long tail (a near-unity feedback loop trends to infinity), and export has to
 * terminate. Raised from the original 30 s, which clipped long reverbs.
 */
export const MAX_AUTO_TAIL_SECONDS = 60;

export type TailDeclarationLike =
    | { kind: 'fixed'; seconds: number; predelayMsParameterId?: string }
    | { kind: 'decaySeconds'; parameterId: string; defaultSeconds: number; predelayMsParameterId?: string }
    | {
          kind: 'feedbackLoop';
          feedbackParameterId: string;
          defaultFeedback: number;
          maxFeedback: number;
          loopParameterId: string;
          loopUnit: 'ms' | 's';
          defaultLoopSeconds: number;
      };

type DeviceLike = {
    type: string;
    parameterValues: Record<string, number>;
    bypassed: boolean;
    /** Declared by the device's descriptor; absent means the device has no tail. */
    tail?: TailDeclarationLike;
};

type TrackLike = {
    devices: DeviceLike[];
};

function readParameter(device: DeviceLike, parameterId: string, fallback: number): number {
    const value = device.parameterValues[parameterId];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return value;
}

function evaluateFeedbackLoop(
    device: DeviceLike,
    tail: Extract<TailDeclarationLike, { kind: 'feedbackLoop' }>
): number {
    const declaredFeedback = readParameter(device, tail.feedbackParameterId, tail.defaultFeedback);
    const feedback = Math.min(tail.maxFeedback, Math.max(0, declaredFeedback));
    if (feedback <= 0) {
        // No feedback means the signal passes once; that repeat is inside the
        // rendered region, so it adds no tail.
        return 0;
    }

    const defaultLoop = tail.loopUnit === 'ms' ? tail.defaultLoopSeconds * 1000 : tail.defaultLoopSeconds;
    const declaredLoop = readParameter(device, tail.loopParameterId, defaultLoop);
    const loopSeconds = tail.loopUnit === 'ms' ? declaredLoop / 1000 : declaredLoop;

    const repeatsToSilence = Math.log(MINUS_60_DB) / Math.log(feedback);
    const tailSeconds = loopSeconds * repeatsToSilence;
    if (!Number.isFinite(tailSeconds)) {
        return 0;
    }
    return tailSeconds;
}

/** Pre-delay shifts the whole tail later, so it adds to the sounding length. */
function withPredelay(device: DeviceLike, seconds: number, predelayMsParameterId: string | undefined): number {
    if (predelayMsParameterId === undefined) {
        return seconds;
    }
    return seconds + readParameter(device, predelayMsParameterId, 0) / 1000;
}

function evaluateDeclaration(device: DeviceLike, tail: TailDeclarationLike): number {
    if (tail.kind === 'fixed') {
        return withPredelay(device, tail.seconds, tail.predelayMsParameterId);
    }

    if (tail.kind === 'decaySeconds') {
        const decaySeconds = readParameter(device, tail.parameterId, tail.defaultSeconds);
        return withPredelay(device, decaySeconds, tail.predelayMsParameterId);
    }

    return evaluateFeedbackLoop(device, tail);
}

/**
 * Composition rule: **sum along a track's chain, then take the longest track.**
 *
 * `buildDeviceChain` wires a track's devices in genuine series
 * (`prev.connect(dn.inputNode); prev = dn.outputNode`), so their tails cascade
 * rather than overlap. A delay ringing for 1.9 s feeds a reverb, and that reverb
 * then needs its own full decay to resolve the delay's *last* echo — so the
 * track needs 1.9 + 2 s, not the 2 s a flat maximum would reserve. Taking the
 * maximum truncated exactly that difference off the end of the export.
 *
 * Summing is an upper bound rather than an exact figure: two cascaded -60 dB
 * decays reach -60 dB overall slightly sooner than the sum of their individual
 * times. Over-reserving costs a little trailing near-silence, whereas
 * under-reserving is an audible cut, so the estimate is deliberately biased to
 * the safe side and bounded by `MAX_AUTO_TAIL_SECONDS`.
 *
 * Tracks are taken as a maximum, not a sum: they render in parallel, so the
 * export must last as long as the slowest one, not their total.
 *
 * Known limit — routing cascades are not summed. A track feeding a bus whose own
 * chain has a reverb is also a cascade, but this service receives only each
 * track's device list, with no routing edges, so track-into-bus is scored as two
 * independent chains. That under-reserves the same way a flat maximum did, on
 * send/bus-heavy sessions specifically. Closing it needs routing in the
 * projection and a cycle-safe walk, which is a larger change than the defect
 * being fixed here.
 */
export function estimateRenderTailSeconds(tracks: ReadonlyArray<TrackLike>): number {
    let longestChain = 0;

    for (const track of tracks) {
        let chainTail = 0;
        for (const device of track.devices) {
            if (device.bypassed || !device.tail) {
                continue;
            }

            const tailSeconds = evaluateDeclaration(device, device.tail);
            if (Number.isFinite(tailSeconds) && tailSeconds > 0) {
                chainTail += tailSeconds;
            }
        }

        if (chainTail > longestChain) {
            longestChain = chainTail;
        }
    }

    return Math.min(MAX_AUTO_TAIL_SECONDS, Math.max(0, longestChain));
}
