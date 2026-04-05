/**
 * Transformer: pure automation point algorithms.
 * No I/O — mathematical functions for simplifying and interpolating automation curves.
 */

import { type AutomationPoint } from '../models/AutomationViewTypes';

function perpendicularDistance(
    point: { beat: number; value: number },
    lineStart: { beat: number; value: number },
    lineEnd: { beat: number; value: number }
): number {
    const dx = lineEnd.beat - lineStart.beat;
    const dy = lineEnd.value - lineStart.value;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) {
        const dbx = point.beat - lineStart.beat;
        const dby = point.value - lineStart.value;
        return Math.sqrt(dbx * dbx + dby * dby);
    }
    const num = Math.abs(
        dy * point.beat - dx * point.value + lineEnd.beat * lineStart.value - lineEnd.value * lineStart.beat
    );
    return num / Math.sqrt(lengthSq);
}

/**
 * Ramer-Douglas-Peucker algorithm for simplifying automation point curves
 * while preserving shape within a given tolerance.
 */
export function rdpSimplify(points: AutomationPoint[], tolerance: number): AutomationPoint[] {
    if (points.length <= 2) {
        return points;
    }

    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0]!;
    const last = points[points.length - 1]!;

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i]!, first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = i;
        }
    }

    if (maxDist > tolerance) {
        const left = rdpSimplify(points.slice(0, maxIdx + 1), tolerance);
        const right = rdpSimplify(points.slice(maxIdx), tolerance);
        return [...left.slice(0, -1), ...right];
    }

    return [first, last];
}

/**
 * Apply tension to a normalized t value (0–1).
 * tension < 0: logarithmic (fast start, slow end)
 * tension = 0: linear
 * tension > 0: exponential (slow start, fast end)
 */
function applyTension(t: number, tension: number): number {
    if (Math.abs(tension) < 0.01) {
        return t;
    }
    // Use power curve with tension mapping
    const power = 2 ** (tension * 3); // Maps -1..+1 to 0.125..8
    return t ** power;
}

/**
 * Interpolates an automation value at a given beat position between two points.
 * Supports linear, step, exponential, s-curve, stairs, and smooth interpolation.
 */
export function interpolateAutomationValue(
    p1: AutomationPoint,
    p2: AutomationPoint,
    beat: number,
    prevPoint?: AutomationPoint,
    nextPoint?: AutomationPoint
): number {
    if (p2.beat === p1.beat) {
        return p1.value;
    }

    if (p1.curve === 'step') {
        return p1.value;
    }

    const t = (beat - p1.beat) / (p2.beat - p1.beat);

    if (p1.curve === 'stairs') {
        const steps = p1.stairSteps ?? 4;
        const steppedT = Math.floor(t * steps) / steps;
        return p1.value + (p2.value - p1.value) * steppedT;
    }

    if (p1.curve === 'exponential') {
        const tension = p1.tension ?? 0;
        const expT = applyTension(t, tension);
        return p1.value + (p2.value - p1.value) * expT;
    }

    if (p1.curve === 's-curve') {
        const tension = p1.tension ?? 0.5;
        const st = t * t * (3 - 2 * t); // Hermite basis
        const curved = t + (st - t) * Math.abs(tension);
        return p1.value + (p2.value - p1.value) * curved;
    }

    if (p1.curve === 'smooth') {
        // Catmull-Rom spline: uses neighboring points for tangents
        const v0 = prevPoint?.value ?? p1.value;
        const v1 = p1.value;
        const v2 = p2.value;
        const v3 = nextPoint?.value ?? p2.value;

        const t2 = t * t;
        const t3 = t2 * t;

        // Catmull-Rom coefficients
        const result =
            0.5 * (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);

        return result;
    }

    // Linear
    return p1.value + (p2.value - p1.value) * t;
}

/**
 * Generate an array of points for a shape within a beat range.
 */
export type AutomationShapeType = 'sine' | 'triangle' | 'sawtooth-up' | 'sawtooth-down' | 'square' | 'random';

export function generateShapePoints(
    shape: AutomationShapeType,
    startBeat: number,
    endBeat: number,
    minValue: number,
    maxValue: number
): AutomationPoint[] {
    const range = maxValue - minValue;
    const duration = endBeat - startBeat;
    const mid = startBeat + duration / 2;

    const pt = (
        beat: number,
        norm: number,
        curve: AutomationPoint['curve'] = 'linear',
        tension = 0
    ): AutomationPoint => ({
        beat,
        value: minValue + norm * range,
        curve,
        tension,
    });

    switch (shape) {
        case 'square':
            // 4 points: high → step down at midpoint → step back at end
            return [pt(startBeat, 1, 'step'), pt(mid, 0, 'step'), pt(endBeat, 1, 'step')];

        case 'triangle':
            // 3 points: low → peak at midpoint → low
            return [pt(startBeat, 0), pt(mid, 1), pt(endBeat, 0)];

        case 'sawtooth-up':
            // 2 points: ramp from low to high
            return [pt(startBeat, 0), pt(endBeat, 1)];

        case 'sawtooth-down':
            // 2 points: ramp from high to low
            return [pt(startBeat, 1), pt(endBeat, 0)];

        case 'sine':
            // 5 key points with smooth curve interpolation
            return [
                pt(startBeat, 0, 'smooth', 0.5),
                pt(startBeat + duration * 0.25, 1, 'smooth', 0.5),
                pt(mid, 0, 'smooth', 0.5),
                pt(startBeat + duration * 0.75, 0, 'smooth', 0.5),
                pt(endBeat, 0, 'smooth', 0.5),
            ];

        case 'random': {
            // 8 random points
            const count = 8;
            const pts: AutomationPoint[] = [];
            for (let i = 0; i <= count; i++) {
                pts.push(pt(startBeat + (i / count) * duration, Math.random()));
            }
            return pts;
        }
    }
}

/**
 * Determine contiguous automation regions (for virgin territory rendering).
 * Returns beat ranges where automation data has been explicitly written.
 * Adjacent points (within maxGap beats) are considered part of the same region.
 */
export function getAutomationRegions(
    points: AutomationPoint[],
    maxGap = Infinity
): { startBeat: number; endBeat: number }[] {
    if (points.length === 0) {
        return [];
    }

    const sorted = [...points].sort((a, b) => a.beat - b.beat);
    const regions: { startBeat: number; endBeat: number }[] = [];
    let regionStart = sorted[0]!.beat;
    let regionEnd = sorted[0]!.beat;

    for (let i = 1; i < sorted.length; i++) {
        const p = sorted[i]!;
        if (p.beat - regionEnd > maxGap) {
            regions.push({ startBeat: regionStart, endBeat: regionEnd });
            regionStart = p.beat;
        }
        regionEnd = p.beat;
    }

    regions.push({ startBeat: regionStart, endBeat: regionEnd });
    return regions;
}
