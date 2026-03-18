/**
 * Transformer: pure automation point algorithms.
 * No I/O — mathematical functions for simplifying and interpolating automation curves.
 */

import { type AutomationPoint } from '../models/Automation';

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
 * Interpolates an automation value at a given beat position between two points.
 * Supports linear, step, exponential, and s-curve interpolation.
 */
export function interpolateAutomationValue(p1: AutomationPoint, p2: AutomationPoint, beat: number): number {
    if (p2.beat === p1.beat) {
        return p1.value;
    }

    if (p1.curve === 'step') {
        return p1.value;
    }

    const t = (beat - p1.beat) / (p2.beat - p1.beat);

    if (p1.curve === 'exponential') {
        const expT = t * t;
        return p1.value + (p2.value - p1.value) * expT;
    }

    if (p1.curve === 's-curve') {
        const tension = p1.tension ?? 0.5;
        const st = t * t * (3 - 2 * t);
        const curved = t + (st - t) * tension;
        return p1.value + (p2.value - p1.value) * curved;
    }

    return p1.value + (p2.value - p1.value) * t;
}
