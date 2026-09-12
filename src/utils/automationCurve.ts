/**
 * Shared automation curve evaluator — the single source of truth for the
 * seven automation curve shapes (linear / exponential / step / s-curve /
 * stairs / smooth / bezier).
 *
 * The three curve-value evaluators finding AU-1 audited — playback plus the
 * editor readout, the paths whose divergence changes what you hear, bounce, or
 * see under the cursor — evaluate automation through THIS function:
 *  - the live apply path (Transport scheduling → Automation
 *    `interpolateAutomationPointValue` → this evaluator),
 *  - the offline compile path (AudioEngine offlineScheduler
 *    `compileAutomationEvents` → this evaluator), and
 *  - the editor playhead value readout (Arrangement transformers
 *    `interpolateAutomationValue` → this evaluator).
 *
 * Audit finding AU-1 (AUDIT-automation.md): these paths previously carried
 * independently hand-maintained copies of this math and had already drifted
 * (documented `stairs` clamping divergence; the editor copy also lacked a
 * `bezier` branch entirely). Collapsing them onto one kernel makes monitor ==
 * bounce == readout by construction. Do not fork this math back into any path;
 * the automation curve-conformance specs guard re-divergence.
 *
 * Residual (follow-up): TimelineEditor's `buildCurvePath` still computes the
 * curve as an SVG path (geometry, not a scalar value) for rendering — tracked
 * as an AU-1 residual; reconcile its control-point handling with this kernel.
 *
 * This kernel lives in `src/utils/` because it is the only home both a module
 * `services/` file (live) and a module `repositories/` file (offline) may
 * import under the dependency-boundary rules: a repository may not reach a
 * foreign module's `useCases/` contract barrel (`repositories-no-business`),
 * so a module-owned barrel could not serve the offline consumer.
 *
 * RT-safe: pure, allocation-free, no locks/IO. Safe to call per scheduler tick.
 */

export type AutomationCurveType = 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth' | 'bezier';

/**
 * Minimal structural shape of an automation point the curve math consumes.
 * Deliberately module-agnostic: `src/utils/` may not import module models, and
 * both `Automation` and `AudioEngine` carry their own (wider) point types that
 * structurally satisfy this. Optional `tension`/`stairSteps`/`cp*` are
 * defaulted here so a missing wire field never yields `NaN`.
 */
export type AutomationCurvePoint = {
    beat: number;
    value: number;
    curve: AutomationCurveType;
    tension?: number;
    stairSteps?: number;
    cp1?: { x: number; y: number };
    cp2?: { x: number; y: number };
};

/** `stairs` step count is a bounded integer (2–32); see AutomationPoint docs. */
const MIN_STAIR_STEPS = 2;
const MAX_STAIR_STEPS = 32;
const DEFAULT_STAIR_STEPS = 4;

/**
 * The `stairs` step count as actually applied: an integer clamped to [2,32]
 * (see AutomationPoint docs). The single source of these bounds — the offline
 * event-emission loop samples stair boundaries with the same count, so it
 * imports this rather than re-inlining the arithmetic (AU-1: no second copy).
 */
export function clampStairSteps(stairSteps: number | undefined): number {
    const truncated = Math.trunc(stairSteps ?? DEFAULT_STAIR_STEPS);
    return Math.min(MAX_STAIR_STEPS, Math.max(MIN_STAIR_STEPS, truncated));
}

/** Default cubic-Bézier x control points, matching the automation renderer. */
const DEFAULT_BEZIER_CX1 = 0.33;
const DEFAULT_BEZIER_CX2 = 0.66;

/**
 * Fixed Newton budget for the `x(s) === fraction` solve. A sane quad converges
 * quadratically from the fraction guess, so six steps reach float64 resolution
 * with margin; a fixed budget keeps the solve O(1) and allocation-free per
 * scheduler tick.
 */
const BEZIER_X_NEWTON_ITERATIONS = 6;

/**
 * Early exit once the x residual drops below the kernel's own fraction
 * resolution — a query fraction is only ever meaningful to ~1e-6 of a segment.
 */
const BEZIER_X_TOLERANCE = 1e-6;

/**
 * Early exit when the x derivative is effectively flat: stepping would divide
 * by ~0 and diverge, so the solve keeps the current `s`.
 */
const BEZIER_X_DERIVATIVE_FLOOR = 1e-9;

/**
 * Ceiling on the subdivision parameter in {@link subdivideBezierRightHalf}. A
 * cut effectively on the segment's end point leaves the right half a sliver
 * narrower than float noise and its x renormalization divides by `1 − X(s)`;
 * clamping the parameter keeps the math finite, whereas falling back to the
 * default quad would NOT be an exact continuation. Raise it toward 1 and that
 * denominator underflows to zero, minting Infinity cps; drop it and a seam a
 * hair inside the segment's end starts describing a visibly earlier cut.
 * 1e-9 sits below the evaluator's own 1e-6 fraction resolution, so no beat can
 * hear the difference, while the renormalization's float-noise amplification
 * (~2.2e-16 / 1e-9 ≈ 2e-7 on cp.x) stays far under that same resolution.
 */
const MAX_BEZIER_CUT_FRACTION = 1 - 1e-9;

function clamp01(value: number): number {
    if (value < 0) {
        return 0;
    }
    if (value > 1) {
        return 1;
    }
    return value;
}

/** Evaluate a cubic Bézier with control values (a, b, c, d) at parameter `s ∈ [0,1]`. */
function cubicBezier(a: number, b: number, c: number, d: number, s: number): number {
    const mt = 1 - s;
    return mt * mt * mt * a + 3 * mt * mt * s * b + 3 * mt * s * s * c + s * s * s * d;
}

/** Derivative of {@link cubicBezier} with respect to `s`. */
function cubicBezierDeriv(a: number, b: number, c: number, d: number, s: number): number {
    const mt = 1 - s;
    return 3 * mt * mt * (b - a) + 6 * mt * s * (c - b) + 3 * s * s * (d - c);
}

type ApplyTensionInput = {
    fraction: number;
    tension: number;
};

/**
 * Warp a linear fraction by exponential tension. A tension inside the ±0.01
 * deadzone is treated as linear (returns the fraction unchanged), so a missing
 * or zero tension degrades to a straight ramp rather than `NaN`.
 */
function applyTension({ fraction, tension }: ApplyTensionInput): number {
    if (Math.abs(tension) < 0.01) {
        return fraction;
    }
    const power = 2 ** (tension * 3);
    return fraction ** power;
}

type EvaluateAutomationCurveInput = {
    firstPoint: AutomationCurvePoint;
    secondPoint: AutomationCurvePoint;
    beat: number;
    previousPoint?: AutomationCurvePoint;
    nextPoint?: AutomationCurvePoint;
};

/**
 * Value of the automation curve on the segment [firstPoint, secondPoint] at
 * `beat`. `previousPoint`/`nextPoint` are the surrounding lane points, used
 * only by the `smooth` (Catmull-Rom) shape for its interior tangents.
 *
 * Golden semantics (converged from the two former copies, per AU-1):
 *  - zero-width OR reversed segment (`secondPoint.beat <= firstPoint.beat`)
 *    holds `firstPoint.value` (was live-side `===` only → garbage on reversed);
 *  - the segment fraction is clamped to [0,1] (was live-side unclamped);
 *  - `stairs` step count is clamped to an integer in [2,32] (was live-side
 *    raw `stairSteps ?? 4` — the documented drift; 0 / negative / fractional
 *    counts produced `NaN` or off-by-a-step values live vs the offline bounce);
 *  - `exponential` / `s-curve` tension defaults (`?? 0` / `?? 0.5`) apply even
 *    when the wire field is absent (was offline-side `NaN` for absent tension).
 */
export function evaluateAutomationCurve({
    firstPoint,
    secondPoint,
    beat,
    previousPoint,
    nextPoint,
}: EvaluateAutomationCurveInput): number {
    if (secondPoint.beat <= firstPoint.beat) {
        return firstPoint.value;
    }

    if (firstPoint.curve === 'step') {
        return firstPoint.value;
    }

    const fraction = clamp01((beat - firstPoint.beat) / (secondPoint.beat - firstPoint.beat));
    const span = secondPoint.value - firstPoint.value;

    if (firstPoint.curve === 'stairs') {
        const steps = clampStairSteps(firstPoint.stairSteps);
        const steppedFraction = Math.floor(fraction * steps) / steps;
        return firstPoint.value + span * steppedFraction;
    }

    if (firstPoint.curve === 'exponential') {
        const warped = applyTension({ fraction, tension: firstPoint.tension ?? 0 });
        return firstPoint.value + span * warped;
    }

    if (firstPoint.curve === 's-curve') {
        const tension = firstPoint.tension ?? 0.5;
        const smoothstep = fraction * fraction * (3 - 2 * fraction);
        const curved = fraction + (smoothstep - fraction) * Math.abs(tension);
        return firstPoint.value + span * curved;
    }

    if (firstPoint.curve === 'smooth') {
        const v0 = previousPoint?.value ?? firstPoint.value;
        const v1 = firstPoint.value;
        const v2 = secondPoint.value;
        const v3 = nextPoint?.value ?? secondPoint.value;

        const t2 = fraction * fraction;
        const t3 = t2 * fraction;

        return (
            0.5 *
            (2 * v1 + (-v0 + v2) * fraction + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3)
        );
    }

    if (firstPoint.curve === 'bezier') {
        // Mirror the render path: a cubic Bézier whose x control points are
        // fractions of the segment span (defaults 0.33/0.66) and whose y
        // control points are the normalized control values (defaulting to the
        // segment endpoints). `fraction` is the position along x, but the
        // Bézier is parameterized by its own `s`; solve x(s) === fraction for
        // `s` (fixed-iteration Newton, allocation-free), then evaluate y(s).
        // The cp reads are deliberately inline — this is the per-tick path and
        // the header's allocation-free claim holds here; `resolveBezierControls`
        // below states the same defaults for edit-time callers, and the kernel
        // spec pins the two to agreement.
        const cx1 = firstPoint.cp1?.x ?? DEFAULT_BEZIER_CX1;
        const cx2 = firstPoint.cp2?.x ?? DEFAULT_BEZIER_CX2;
        const cy1 = firstPoint.cp1?.y ?? firstPoint.value;
        const cy2 = firstPoint.cp2?.y ?? secondPoint.value;
        const y0 = firstPoint.value;
        const y3 = secondPoint.value;

        const s = solveBezierXParameter({ cx1, cx2, fraction });

        return cubicBezier(y0, cy1, cy2, y3, s);
    }

    return firstPoint.value + span * fraction;
}

/** The cubic-Bézier control quad as the kernel actually evaluates it. */
export type BezierControlQuad = {
    /** First x control, a fraction of the segment's beat span. */
    cx1: number;
    /** Second x control, a fraction of the segment's beat span. */
    cx2: number;
    /** First y control, an absolute automation value. */
    cy1: number;
    /** Second y control, an absolute automation value. */
    cy2: number;
};

type ResolveBezierControlsInput = {
    firstPoint: AutomationCurvePoint;
    secondPoint: AutomationCurvePoint;
};

/**
 * The quad {@link evaluateAutomationCurve}'s bezier branch evaluates: authored
 * cps where present, the renderer defaults where not (x as span fractions, y
 * as the segment endpoints). Edit-time callers that must continue a bezier
 * segment exactly — the split seam — derive their math from THIS quad, the
 * same one the source played, rather than re-deriving the defaults.
 */
export function resolveBezierControls({ firstPoint, secondPoint }: ResolveBezierControlsInput): BezierControlQuad {
    return {
        cx1: firstPoint.cp1?.x ?? DEFAULT_BEZIER_CX1,
        cx2: firstPoint.cp2?.x ?? DEFAULT_BEZIER_CX2,
        cy1: firstPoint.cp1?.y ?? firstPoint.value,
        cy2: firstPoint.cp2?.y ?? secondPoint.value,
    };
}

type SolveBezierXParameterInput = {
    cx1: number;
    cx2: number;
    fraction: number;
};

/**
 * Newton-solve `x(s) === fraction` for the x quad (0, cx1, cx2, 1): the
 * Bézier's own parameter `s` that lands on the query position along x. This
 * is the evaluator's loop verbatim (same budget, same epsilons), so the seam
 * parameter a subdivision solves for is the parameter the evaluator itself
 * would land on.
 */
function solveBezierXParameter({ cx1, cx2, fraction }: SolveBezierXParameterInput): number {
    let s = fraction;
    for (let iter = 0; iter < BEZIER_X_NEWTON_ITERATIONS; iter++) {
        const xs = cubicBezier(0, cx1, cx2, 1, s) - fraction;
        if (Math.abs(xs) < BEZIER_X_TOLERANCE) {
            break;
        }
        const dx = cubicBezierDeriv(0, cx1, cx2, 1, s);
        if (Math.abs(dx) < BEZIER_X_DERIVATIVE_FLOOR) {
            break;
        }
        s = clamp01(s - xs / dx);
    }
    return s;
}

/** One de Casteljau corner cut: the point `s` of the way from `from` to `to`. */
function lerp(from: number, to: number, s: number): number {
    return from + (to - from) * s;
}

/**
 * The right half of a de Casteljau-subdivided segment: the on-curve point at
 * the cut plus the right half's inner control points as automation cps.
 */
export type BezierRightHalfControls = {
    /** The subdivision point along x — the cut's span fraction X(s). */
    xAtCut: number;
    /** The subdivision point along y — the played value Y(s) at the cut. */
    yAtCut: number;
    cp1: { x: number; y: number };
    cp2: { x: number; y: number };
};

type SubdivideBezierRightHalfInput = BezierControlQuad & {
    /** Segment start value — the quad's y endpoint y0. */
    y0: number;
    /** Segment end value — the quad's y endpoint y3. */
    y3: number;
    /** Cut position as a fraction of the segment's beat span. Clamped here. */
    cutFraction: number;
};

/**
 * Split the cubic quad (x: 0 → cx1 → cx2 → 1, y: y0 → cy1 → cy2 → y3) at the
 * cut by de Casteljau and return the RIGHT half's inner control points, so a
 * segment re-based to start at the cut plays the exact continuation of the
 * source curve.
 *
 * Why de Casteljau: subdividing a Bézier at parameter `s` yields the
 * restriction of the SAME polynomial to [s, 1] re-parameterized over [0,1] —
 * the right half is the continuation, not an approximation of it. The `s` is
 * solved from the cut fraction with the evaluator's own Newton loop, so the
 * subdivision point is the point the evaluator plays at the cut.
 *
 * Only the x controls are renormalized: they are fractions of the segment's
 * beat span, and the right half's span [X(s), 1] must read as [0, 1] over the
 * shortened segment. The y controls are absolute values — the right half
 * keeps its off-point values verbatim, no renormalization.
 */
export function subdivideBezierRightHalf({
    cx1,
    cx2,
    cy1,
    cy2,
    y0,
    y3,
    cutFraction,
}: SubdivideBezierRightHalfInput): BezierRightHalfControls {
    const clampedCut = Math.min(clamp01(cutFraction), MAX_BEZIER_CUT_FRACTION);
    const s = solveBezierXParameter({ cx1, cx2, fraction: clampedCut });

    // De Casteljau: each level cuts the previous level's chords at `s`; after
    // three levels the innermost points meet on the curve (xAtCut === X(s),
    // y0123 === Y(s)) and the points flanking the meeting point are the two
    // halves' inner control points.
    const x01 = lerp(0, cx1, s);
    const x12 = lerp(cx1, cx2, s);
    const x23 = lerp(cx2, 1, s);
    const x012 = lerp(x01, x12, s);
    const x123 = lerp(x12, x23, s);
    const xAtCut = lerp(x012, x123, s);

    const y01 = lerp(y0, cy1, s);
    const y12 = lerp(cy1, cy2, s);
    const y23 = lerp(cy2, y3, s);
    const y012 = lerp(y01, y12, s);
    const y123 = lerp(y12, y23, s);
    const y0123 = lerp(y012, y123, s);

    // The on-curve point belongs to the seam itself; it is returned (rather
    // than dropped) so the caller can pin the seam's value to the very point
    // the continuation starts from, instead of trusting a second evaluation.
    return {
        xAtCut,
        yAtCut: y0123,
        cp1: { x: (x123 - xAtCut) / (1 - xAtCut), y: y123 },
        cp2: { x: (x23 - xAtCut) / (1 - xAtCut), y: y23 },
    };
}
