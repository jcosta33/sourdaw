/**
 * Move a group of linked band values together from one representative band.
 *
 * A macro knob on a multiband module shows one band and drives the group. The
 * established behaviour in mastering suites is a relative move: every linked
 * band shifts by the same offset, so the voicing the preset shipped — the tilt
 * between bands — survives the gesture. Writing the representative value into
 * every band instead flattens a factory preset's whole multiband curve on the
 * first nudge, silently and irreversibly.
 *
 * The offset is clamped once for the group rather than per band, so a band that
 * reaches the end of its range stops the whole group there instead of collapsing
 * the distance between bands. That is why the representative band can stop short
 * of the requested value.
 */
type GetLinkedBandValuesInput = {
    /** Current values of the linked bands, in band order. */
    values: readonly number[];
    /** Index into `values` of the band the macro control displays. */
    representativeIndex: number;
    /** Value the gesture asked the represented band to take. */
    requestedValue: number;
    min: number;
    max: number;
};

export function getLinkedBandValues({
    values,
    representativeIndex,
    requestedValue,
    min,
    max,
}: GetLinkedBandValuesInput): number[] {
    const representative = values[representativeIndex];
    if (representative === undefined) {
        return [...values];
    }

    let offset = requestedValue - representative;
    for (const value of values) {
        offset = Math.min(offset, max - value);
        offset = Math.max(offset, min - value);
    }

    return values.map((value) => Math.min(max, Math.max(min, value + offset)));
}
