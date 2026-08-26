import { FADER_MAX_GAIN } from '../audioLevelLaw';
import { type AutomationCurveType } from '../automationCurve';

/**
 * Shared case tables for the automation conformance specs: the AU-1 curve
 * table and the #2539 lane-bound table. One numeric source of truth per law,
 * so the live-side and offline-side conformance specs cannot drift in what
 * they exercise. Each spec maps a case into its own input shape (a live
 * segment / an offline lane).
 *
 * Geometry convention: a case describes the single segment on beats [0, 4].
 * `previousValue` / `nextValue`, when set, are the surrounding lane points at
 * beats -4 and 8 (used only by the `smooth` Catmull-Rom tangents).
 */

export type AutomationCurveCase = {
    name: string;
    curve: AutomationCurveType;
    startValue: number;
    endValue: number;
    tension?: number;
    stairSteps?: number;
    cp1?: { x: number; y: number };
    cp2?: { x: number; y: number };
    previousValue?: number;
    nextValue?: number;
};

/** First point at beat 0, second point at beat 4. */
export const CASE_FIRST_BEAT = 0;
export const CASE_SECOND_BEAT = 4;
/** Neighbor points (smooth tangents) at these beats when a case supplies them. */
export const CASE_PREVIOUS_BEAT = -4;
export const CASE_NEXT_BEAT = 8;

/** Beats sampled across the [0, 4] segment, including endpoints and near-end. */
export const CONFORMANCE_SAMPLE_BEATS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 3.9, 4];

export const AUTOMATION_CURVE_CASES: AutomationCurveCase[] = [
    { name: 'linear', curve: 'linear', startValue: 0.2, endValue: 0.9 },
    { name: 'step', curve: 'step', startValue: 0.3, endValue: 0.9 },
    { name: 'stairs-default', curve: 'stairs', startValue: 0, endValue: 1 },
    { name: 'stairs-8', curve: 'stairs', startValue: 0, endValue: 1, stairSteps: 8 },
    // AU-1 divergence demonstrators: the pre-collapse live copy did not clamp or
    // truncate stairSteps (0 → NaN, 1 / fractional / >32 mis-stepped) while the
    // offline bounce clamped to an integer in [2,32].
    { name: 'stairs-zero', curve: 'stairs', startValue: 0, endValue: 1, stairSteps: 0 },
    { name: 'stairs-one', curve: 'stairs', startValue: 0, endValue: 1, stairSteps: 1 },
    { name: 'stairs-fractional', curve: 'stairs', startValue: 0, endValue: 1, stairSteps: 2.7 },
    { name: 'stairs-over-max', curve: 'stairs', startValue: 0, endValue: 1, stairSteps: 100 },
    { name: 'exponential-pos', curve: 'exponential', startValue: 0, endValue: 1, tension: 1 },
    { name: 'exponential-neg', curve: 'exponential', startValue: 0, endValue: 1, tension: -0.6 },
    { name: 's-curve', curve: 's-curve', startValue: 0, endValue: 1, tension: 0.5 },
    { name: 'smooth', curve: 'smooth', startValue: 0.2, endValue: 0.8, previousValue: -0.1, nextValue: 1.2 },
    { name: 'smooth-no-neighbors', curve: 'smooth', startValue: 0.2, endValue: 0.8 },
    {
        name: 'bezier',
        curve: 'bezier',
        startValue: 0,
        endValue: 1,
        cp1: { x: 0.25, y: 0.9 },
        cp2: { x: 0.75, y: 0.1 },
    },
];

/**
 * A lane-bound case: the inputs of the shared `boundAutomationLaneValue` law
 * (`#/utils/automationLaneBound`) plus the lane geometry the both-side
 * conformance specs build around it. `value` is a raw (pre-bound) interpolated
 * value the row is about; `expected` is the one value the law may produce for
 * it. The geometry fields follow the curve-table convention above — the
 * segment's stored points at beats 0 and 4, `smooth` neighbours at -4 and 8
 * whose values push the raw curve toward `value`'s side of the range — so the
 * side specs sample real beats and compare against the law applied to the
 * shared curve kernel's raw output, rather than asserting a bare tuple.
 *
 * Rows whose `derivedCeiling` exceeds `declaredMax` are realizable live only
 * as the legacy track gain lane shape (`parameterId: 'gain'`, declared
 * [0, 1], no clip) — the one lane `getAutomationLaneCeiling` widens. The
 * live-side spec builds exactly that lane for them; the offline side injects
 * `derivedCeiling` through `resolveLaneCeiling`, which is the same law
 * arriving by injection.
 */
export type AutomationLaneBoundCase = {
    name: string;
    value: number;
    segmentFirstValue: number;
    segmentSecondValue: number;
    declaredMin: number;
    declaredMax: number;
    derivedCeiling: number;
    expected: number;
    previousValue: number;
    nextValue: number;
};

export const AUTOMATION_BOUND_CASES: AutomationLaneBoundCase[] = [
    {
        // The canonical Catmull-Rom overshoot (raw ~1.0749 near beat 2.35):
        // spline crest past a declared ceiling no stored point exceeds.
        name: 'overshoot-held-at-declared-ceiling',
        value: 1.0749,
        segmentFirstValue: 0.95,
        segmentSecondValue: 1.0,
        declaredMin: 0,
        declaredMax: 1,
        derivedCeiling: 1,
        expected: 1,
        previousValue: 0.2,
        nextValue: 0.2,
    },
    {
        // The bracket's maximum rides its SECOND point (the ride up into
        // headroom): a bound that read only the first point would flatten this
        // at the declared 1.
        name: 'raise-bracket-max-on-second-point',
        value: 1.6362,
        segmentFirstValue: 1.45,
        segmentSecondValue: 1.5,
        declaredMin: 0,
        declaredMax: 1,
        derivedCeiling: FADER_MAX_GAIN,
        expected: 1.5,
        previousValue: 0.2,
        nextValue: 0.2,
    },
    {
        // The mirror: the bracket's maximum rides its FIRST point.
        name: 'raise-bracket-max-on-first-point',
        value: 1.62,
        segmentFirstValue: 1.55,
        segmentSecondValue: 1.2,
        declaredMin: 0,
        declaredMax: 1,
        derivedCeiling: FADER_MAX_GAIN,
        expected: 1.55,
        previousValue: 0.2,
        nextValue: 0.2,
    },
    {
        // One bracketing point below the declared ceiling, one above it: the
        // raise lands on the higher stored point, not on the derived ceiling.
        name: 'bracket-straddles-declared-ceiling',
        value: 1.45,
        segmentFirstValue: 0.8,
        segmentSecondValue: 1.4,
        declaredMin: 0,
        declaredMax: 1,
        derivedCeiling: FADER_MAX_GAIN,
        expected: 1.4,
        previousValue: 0.2,
        nextValue: 0.2,
    },
    {
        // Derived headroom exists but neither bracketing point reaches past
        // the declared ceiling: no raise, and the overshoot stays at declared —
        // the untouched-legacy-project law (a lane whose points all sit at or
        // below its declared ceiling clamps exactly as it did before).
        name: 'bracket-below-declared-ceiling-no-raise',
        value: 1.05,
        segmentFirstValue: 0.9,
        segmentSecondValue: 0.95,
        declaredMin: 0,
        declaredMax: 1,
        derivedCeiling: FADER_MAX_GAIN,
        expected: 1,
        previousValue: 0.2,
        nextValue: 0.2,
    },
    {
        // No raise when the derived ceiling does not exceed the declared one
        // (every lane but the legacy gain shape).
        name: 'derived-not-above-declared-no-raise',
        value: 2.4,
        segmentFirstValue: 0.5,
        segmentSecondValue: 1.9,
        declaredMin: 0,
        declaredMax: 2,
        derivedCeiling: 2,
        expected: 2,
        previousValue: 0.2,
        nextValue: 0.2,
    },
    {
        // A raised ceiling lifts the ceiling only — an interior value below
        // the declared one passes through untouched.
        name: 'raise-does-not-lift-interior-values',
        value: 0.5,
        segmentFirstValue: 1.45,
        segmentSecondValue: 1.5,
        declaredMin: 0,
        declaredMax: 1,
        derivedCeiling: FADER_MAX_GAIN,
        expected: 0.5,
        previousValue: 0.2,
        nextValue: 0.2,
    },
    {
        // An in-range value must come back bit-identical: the bound contains
        // overshoot, it does not re-round the curve.
        name: 'inside-range-untouched',
        value: 0.5,
        segmentFirstValue: 0.2,
        segmentSecondValue: 0.8,
        declaredMin: 0,
        declaredMax: 1,
        derivedCeiling: 1,
        expected: 0.5,
        previousValue: 0.2,
        nextValue: 0.2,
    },
    {
        // The floor is the mirror of the crest: a smooth descent undershooting
        // the declared floor (raw ~-1.0749) is held AT the floor, not past it.
        name: 'negative-value-floor',
        value: -1.0749,
        segmentFirstValue: -0.95,
        segmentSecondValue: -1.0,
        declaredMin: -1,
        declaredMax: 1,
        derivedCeiling: 1,
        expected: -1,
        previousValue: -0.2,
        nextValue: -0.2,
    },
    {
        // A lane fixture that never set its bounds degrades to a no-op rather
        // than NaN-silencing the render (max absent).
        name: 'non-finite-max-passes-through',
        value: -5,
        segmentFirstValue: 0,
        segmentSecondValue: 1,
        declaredMin: 0,
        declaredMax: Number.NaN,
        derivedCeiling: Number.NaN,
        expected: -5,
        previousValue: 0.2,
        nextValue: 0.2,
    },
    {
        // The floor half of the same guard (min absent).
        name: 'non-finite-min-passes-through',
        value: 1.2,
        segmentFirstValue: 0.95,
        segmentSecondValue: 1.0,
        declaredMin: Number.NaN,
        declaredMax: 1,
        derivedCeiling: 1,
        expected: 1.2,
        previousValue: 0.2,
        nextValue: 0.2,
    },
];
