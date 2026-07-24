/**
 * Transformer: pure automation point algorithms.
 * No I/O — mathematical functions for interpolating and shaping automation curves.
 */

import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationPoint } from '../models/AutomationViewTypes';

/**
 * Interpolates an automation value at a given beat position between two points.
 *
 * Delegates to the shared curve kernel `evaluateAutomationCurve`
 * (`#/utils/automationCurve`) — the single implementation the live apply path
 * (`interpolateAutomationPointValue`) and offline compile path
 * (`compileAutomationEvents`) also route through (finding AU-1). This is the
 * editor playhead value readout (AutomationLaneRow); routing it through the
 * kernel keeps the number under the cursor equal to what plays and bounces.
 * Previously this was an independent copy that clamped no `stairs` bounds and
 * had no `bezier` branch (bezier lanes read as linear). Do not reintroduce
 * local curve math here; the automation curve-conformance specs guard against
 * re-divergence.
 */
export function interpolateAutomationValue(
    p1: AutomationPoint,
    p2: AutomationPoint,
    beat: number,
    prevPoint?: AutomationPoint,
    nextPoint?: AutomationPoint
): number {
    return evaluateAutomationCurve({ firstPoint: p1, secondPoint: p2, beat, previousPoint: prevPoint, nextPoint });
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

    function pt(beat: number, norm: number, curve: AutomationPoint['curve'] = 'linear', tension = 0): AutomationPoint {
        return {
            beat,
            value: minValue + norm * range,
            curve,
            tension,
        };
    }

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
            for (let index = 0; index <= count; index++) {
                pts.push(pt(startBeat + (index / count) * duration, Math.random()));
            }
            return pts;
        }
    }

    return [];
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

    const sorted = [...points].sort((alpha, buffer) => alpha.beat - buffer.beat);
    const regions: { startBeat: number; endBeat: number }[] = [];
    let regionStart = sorted[0]!.beat;
    let regionEnd = sorted[0]!.beat;

    for (let index = 1; index < sorted.length; index++) {
        const param = sorted[index]!;
        if (param.beat - regionEnd > maxGap) {
            regions.push({ startBeat: regionStart, endBeat: regionEnd });
            regionStart = param.beat;
        }
        regionEnd = param.beat;
    }

    regions.push({ startBeat: regionStart, endBeat: regionEnd });
    return regions;
}
