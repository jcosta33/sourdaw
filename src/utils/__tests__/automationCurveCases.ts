import { type AutomationCurveType } from '../automationCurve';

/**
 * Shared case table for the AU-1 automation curve-conformance specs. One
 * numeric source of truth for every curve shape + edge, so the live-side and
 * offline-side conformance specs cannot drift in what they exercise. Each spec
 * maps a case into its own input shape (a live segment / an offline lane).
 *
 * Geometry convention: the case describes the single segment on beats [0, 4].
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
