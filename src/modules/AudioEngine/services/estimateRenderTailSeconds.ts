/**
 * Longest declared render tail across a project, in seconds.
 *
 * OE-9 — this used to be a hardcoded switch over `builtin-reverb` and
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
    | { kind: 'fixed'; seconds: number }
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

function evaluateDeclaration(device: DeviceLike, tail: TailDeclarationLike): number {
    if (tail.kind === 'fixed') {
        return tail.seconds;
    }

    if (tail.kind === 'decaySeconds') {
        const decaySeconds = readParameter(device, tail.parameterId, tail.defaultSeconds);
        if (tail.predelayMsParameterId === undefined) {
            return decaySeconds;
        }
        const predelayMs = readParameter(device, tail.predelayMsParameterId, 0);
        return decaySeconds + predelayMs / 1000;
    }

    return evaluateFeedbackLoop(device, tail);
}

export function estimateRenderTailSeconds(tracks: ReadonlyArray<TrackLike>): number {
    let maxTail = 0;

    for (const track of tracks) {
        for (const device of track.devices) {
            if (device.bypassed || !device.tail) {
                continue;
            }

            const tailSeconds = evaluateDeclaration(device, device.tail);
            if (Number.isFinite(tailSeconds) && tailSeconds > maxTail) {
                maxTail = tailSeconds;
            }
        }
    }

    return Math.min(MAX_AUTO_TAIL_SECONDS, Math.max(0, maxTail));
}
