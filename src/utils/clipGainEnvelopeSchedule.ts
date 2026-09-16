/**
 * Shared clip gain-envelope schedule — the single source of truth for how an
 * envelope curve becomes `AudioParam` events on either runtime (#2865).
 *
 * The curve's law (linear in dB between points) lives with the envelope data
 * (`sampleGainEnvelopeSeries`); this file owns what every renderer does with
 * those breakpoints: convert dB to a linear amplitude, hold the curve at the
 * moment sound actually starts, and lay it on a gain `AudioParam` as a ramp
 * series. Live (`scheduleAudioClips`) and the offline render
 * (`scheduleOfflineClipSource`) both call these; do not fork either half back
 * into one runtime.
 *
 * RT-safe: pure, allocation-free apart from the returned anchor list.
 */

/**
 * The bounds every envelope write path clamps to (`addGainEnvelopePoint`,
 * `moveGainEnvelopePoint`). Restated at the read so a value persisted before
 * those clamps — the store's decoder only checks finiteness — cannot reach a
 * `10 ** (db / 20)` conversion large enough to blast the mix or small enough
 * to matter.
 */
const ENVELOPE_MIN_GAIN_DB = -60;
const ENVELOPE_MAX_GAIN_DB = 12;

/** One scheduled envelope breakpoint: when it lands, as a linear amplitude. */
export type GainCurveAnchor = Readonly<{
    /** Absolute time on the rendering clock, as the caller maps beats there. */
    time: number;
    gain: number;
}>;

/** An envelope's dB value as the linear amplitude a gain node takes. */
export function envelopeGainDbToLinear(gainDb: number): number {
    const clampedDb = Math.min(ENVELOPE_MAX_GAIN_DB, Math.max(ENVELOPE_MIN_GAIN_DB, gainDb));
    return 10 ** (clampedDb / 20);
}

/**
 * Hold a curve at `audibleStart`: drop the anchors that precede it and, when
 * one does, lead with the curve's value *at* `audibleStart` instead of its
 * value at the next remaining anchor.
 *
 * Anchors before the moment sound begins describe a curve nobody hears, but
 * simply clipping them would step the gain from the first surviving anchor's
 * value — a mid-curve resume would jump to the next breakpoint. The held value
 * interpolates the dropped span on the param's own ramp law (exponential in
 * amplitude, linear in dB), so what sounds is the curve at that instant.
 */
export function foldGainCurveAnchorsToAudibleStart(
    anchors: readonly GainCurveAnchor[],
    audibleStart: number
): readonly GainCurveAnchor[] {
    if (anchors.length === 0) {
        return anchors;
    }

    let keptFrom = anchors.length;
    for (let index = 0; index < anchors.length; index++) {
        if (anchors[index]!.time >= audibleStart) {
            keptFrom = index;
            break;
        }
    }

    if (keptFrom === anchors.length) {
        // The whole curve precedes the audible window: hold its final value.
        return [{ time: audibleStart, gain: anchors[anchors.length - 1]!.gain }];
    }

    if (keptFrom === 0 || anchors[keptFrom]!.time === audibleStart) {
        return anchors;
    }

    const before = anchors[keptFrom - 1]!;
    const after = anchors[keptFrom]!;
    const span = after.time - before.time;
    const held =
        span > 0 ? before.gain * (after.gain / before.gain) ** ((audibleStart - before.time) / span) : after.gain;
    return [{ time: audibleStart, gain: held }, ...anchors.slice(keptFrom)];
}

/**
 * Lay a folded anchor series onto a gain `AudioParam`: hold the first anchor's
 * value, then ramp to each later one.
 *
 * `exponentialRampToValueAtTime` is the param primitive that matches the
 * envelope's law — exponential in amplitude is linear in dB, so the ramp
 * between two anchors reproduces the drawn curve exactly. It demands nonzero
 * endpoint values, which `envelopeGainDbToLinear` guarantees by construction.
 */
export function applyGainCurveAnchorsToParam(param: AudioParam, anchors: readonly GainCurveAnchor[]): void {
    if (anchors.length === 0) {
        return;
    }

    param.setValueAtTime(anchors[0]!.gain, anchors[0]!.time);
    for (let index = 1; index < anchors.length; index++) {
        param.exponentialRampToValueAtTime(anchors[index]!.gain, anchors[index]!.time);
    }
}
