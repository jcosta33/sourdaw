/**
 * Shared automation lane bound — the single source of truth for the law that
 * keeps an interpolated automation value inside its lane's declared
 * `minValue`/`maxValue`.
 *
 * The two runtimes a bounce is compared against both evaluate this law on every
 * value they hand onward:
 *  - the live apply path (Transport `applyAutomation` → Automation
 *    `getAutomationValueAtBeat` → this bound, per segment, before the link
 *    scale), and
 *  - the offline compile path (AudioEngine offlineScheduler
 *    `compileAutomationEvents`' `valueBound` → this bound, per segment, before
 *    `valueScale`/`valueTransform`) — on every lane family: gain, pan, sends,
 *    and device parameters (#2538/#2539).
 *
 * Non-linear interpolation is why the law exists at all: Catmull-Rom ('smooth')
 * overshoots between control points by construction, so an interior segment can
 * briefly produce a value the lane says it cannot hold — and the declared range
 * is a contract every downstream reader (device-param clamps, AudioParam
 * schedulers) assumes already holds. Before the kernel was shared, only the
 * gain branch of the offline scheduler transcribed this math and the other
 * branches printed the overshoot the monitor had clamped away; the two bodies
 * could drift with no gate between them — the exact shape that already bit the
 * curve math (PR #616 deleted the curve-conformance spec and the copies
 * drifted). Do not fork this law back into any path; the automation
 * lane-bound-conformance specs guard re-divergence.
 *
 * This kernel lives in `src/utils/` for the same reason the curve kernel
 * (`automationCurve.ts`) does: it is the only home both a module `useCases/`
 * file (live) and a module `repositories/` file (offline) may import under the
 * dependency-boundary rules. The derived ceiling arrives as a parameter rather
 * than being computed here because it is the Automation module's law
 * (`getAutomationLaneCeiling`); live passes its own derivation and the offline
 * render passes the same law injected by its caller.
 *
 * RT-safe: pure, allocation-free, no locks/IO. Safe to call per scheduler tick.
 */

export type BoundAutomationLaneValueInput = {
    /** The raw (pre-bound) interpolated value. */
    value: number;
    /** The lane's declared `minValue` — the floor. */
    declaredMin: number;
    /** The lane's declared `maxValue` — the ceiling unless the raise widens it. */
    declaredMax: number;
    /**
     * The ceiling the lane really has (`getAutomationLaneCeiling` live, the
     * injected `resolveLaneCeiling` offline) — the most the raise below may
     * widen to. Equal to `declaredMax` for every lane but a legacy track gain
     * lane.
     */
    derivedCeiling: number;
    /**
     * The two stored points bracketing the segment the value came from. At a
     * held value (before the first point, after the last) both are that held
     * value.
     */
    segmentFirstValue: number;
    segmentSecondValue: number;
};

/**
 * Bound a raw interpolated value to its lane's declared range: floor at
 * `declaredMin`, ceiling at `declaredMax` raised only as far as a stored point
 * on the segment in play actually reaches, and never past `derivedCeiling`.
 *
 * That is two jobs kept apart on purpose. Containing spline overshoot uses the
 * *declared* value: a gain lane authored before the fader gained its `+6 dB`
 * of headroom stores `maxValue: 1`, and bounding its overshoot at the derived
 * ceiling instead would make a project saved last week — opened and played with
 * no edit at all — up to `+6 dB` louder wherever a smooth curve rides near
 * unity. The derived ceiling governs what may be *written* into a lane, not
 * what an untouched curve is allowed to overshoot to.
 *
 * The raise is what keeps the two consistent: `paintDrawPoint` can put a point
 * at `1.5` into a legacy lane, and flattening that stored point back to unity
 * would make the drawn curve, what is heard, and what the offline path exports
 * three different things. Bounding by the segment's own points honours it
 * without inventing level anywhere else: a lane whose points all sit at or
 * below its declared ceiling clamps exactly as it did before.
 *
 * The raise is segment-local (the two bracketing points, not a lane-wide
 * maximum) because a legacy lane with a peak in one segment and a plateau in
 * another must not let the plateau's overshoot through on the strength of a
 * peak that is not in it — the monitor holds it at the declared ceiling while
 * the bounce prints the overshoot, at the same playhead position.
 *
 * A non-finite declared bound disables the law: several specs and legacy
 * fixtures construct lanes with only the fields their assertions touch, and a
 * `NaN` bound would silence the render rather than degrade gracefully.
 */
export function boundAutomationLaneValue({
    value,
    declaredMin,
    declaredMax,
    derivedCeiling,
    segmentFirstValue,
    segmentSecondValue,
}: BoundAutomationLaneValueInput): number {
    if (!Number.isFinite(declaredMin) || !Number.isFinite(declaredMax)) {
        return value;
    }
    let ceiling = declaredMax;
    if (derivedCeiling > ceiling) {
        const highestStored = Math.max(segmentFirstValue, segmentSecondValue);
        if (highestStored > ceiling) {
            ceiling = Math.min(derivedCeiling, highestStored);
        }
    }
    return Math.min(ceiling, Math.max(declaredMin, value));
}
