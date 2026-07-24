/**
 * Shared automation curve evaluator — the single source of truth for the
 * seven automation curve shapes (linear / exponential / step / s-curve /
 * stairs / smooth / bezier).
 *
 * Both runtimes evaluate automation through THIS function:
 *  - the live apply path (Transport scheduling → Automation
 *    `interpolateAutomationPointValue` → this evaluator), and
 *  - the offline compile path (AudioEngine offlineScheduler
 *    `compileAutomationEvents` → this evaluator).
 *
 * Audit finding AU-1 (AUDIT-automation.md): the two runtimes previously
 * carried independently hand-maintained copies of this math and had already
 * drifted (documented `stairs` clamping divergence). Collapsing to one kernel
 * makes monitor == bounce by construction. Do not fork this math back into a
 * runtime; the automation curve-conformance specs guard against re-divergence.
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

/** Default cubic-Bézier x control points, matching the automation renderer. */
const DEFAULT_BEZIER_CX1 = 0.33;
const DEFAULT_BEZIER_CX2 = 0.66;

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
        const rawSteps = Math.trunc(firstPoint.stairSteps ?? DEFAULT_STAIR_STEPS);
        const steps = Math.min(MAX_STAIR_STEPS, Math.max(MIN_STAIR_STEPS, rawSteps));
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
        const cx1 = firstPoint.cp1?.x ?? DEFAULT_BEZIER_CX1;
        const cx2 = firstPoint.cp2?.x ?? DEFAULT_BEZIER_CX2;
        const cy1 = firstPoint.cp1?.y ?? firstPoint.value;
        const cy2 = firstPoint.cp2?.y ?? secondPoint.value;
        const y0 = firstPoint.value;
        const y3 = secondPoint.value;

        let s = fraction;
        for (let iter = 0; iter < 6; iter++) {
            const xs = cubicBezier(0, cx1, cx2, 1, s) - fraction;
            if (Math.abs(xs) < 1e-6) {
                break;
            }
            const dx = cubicBezierDeriv(0, cx1, cx2, 1, s);
            if (Math.abs(dx) < 1e-9) {
                break;
            }
            s = clamp01(s - xs / dx);
        }

        return cubicBezier(y0, cy1, cy2, y3, s);
    }

    return firstPoint.value + span * fraction;
}
