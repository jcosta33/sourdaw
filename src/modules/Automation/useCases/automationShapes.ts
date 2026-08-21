import { createSeededRandom } from '#/utils/SeededRandom/SeededRandom';

import { type AutomationPoint } from '../models/Automation';
import { automationStore } from '../stores/automationStore';

import { DEFAULT_BEAT_MERGE_EPSILON, batchAddAutomationPoints } from './automation/batchAddAutomationPoints';
import { getAutomationLaneCeiling } from './automation/getAutomationLaneCeiling';

// Local shape (AGENTS.md model isolation). Structurally compatible with what
// Arrangement's `generateShapePoints` accepts; we do not import the type from
// another module's transformer or use case surface.
export type AutomationShapeType = 'sine' | 'triangle' | 'sawtooth-up' | 'sawtooth-down' | 'square' | 'random';

type GenerateAutomationShapePointsInput = {
    shape: AutomationShapeType;
    startBeat: number;
    endBeat: number;
    minValue: number;
    maxValue: number;
};

type MakeAutomationPointInput = {
    beat: number;
    norm: number;
    curve?: AutomationPoint['curve'];
    tension?: number;
};

function generateAutomationShapePoints({
    shape,
    startBeat,
    endBeat,
    minValue,
    maxValue,
}: GenerateAutomationShapePointsInput): AutomationPoint[] {
    const range = maxValue - minValue;
    const duration = endBeat - startBeat;
    const mid = startBeat + duration / 2;

    function makePoint({ beat, norm, curve = 'linear', tension = 0 }: MakeAutomationPointInput): AutomationPoint {
        return {
            beat,
            value: minValue + norm * range,
            curve,
            tension,
        };
    }

    switch (shape) {
        case 'square':
            return [
                makePoint({ beat: startBeat, norm: 1, curve: 'step' }),
                makePoint({ beat: mid, norm: 0, curve: 'step' }),
                makePoint({ beat: endBeat, norm: 1, curve: 'step' }),
            ];
        case 'triangle':
            return [
                makePoint({ beat: startBeat, norm: 0 }),
                makePoint({ beat: mid, norm: 1 }),
                makePoint({ beat: endBeat, norm: 0 }),
            ];
        case 'sawtooth-up':
            return [makePoint({ beat: startBeat, norm: 0 }), makePoint({ beat: endBeat, norm: 1 })];
        case 'sawtooth-down':
            return [makePoint({ beat: startBeat, norm: 1 }), makePoint({ beat: endBeat, norm: 0 })];
        case 'sine':
            return [
                makePoint({ beat: startBeat, norm: 0, curve: 'smooth', tension: 0.5 }),
                makePoint({ beat: startBeat + duration * 0.25, norm: 1, curve: 'smooth', tension: 0.5 }),
                makePoint({ beat: mid, norm: 0, curve: 'smooth', tension: 0.5 }),
                makePoint({ beat: startBeat + duration * 0.75, norm: 0, curve: 'smooth', tension: 0.5 }),
                makePoint({ beat: endBeat, norm: 0, curve: 'smooth', tension: 0.5 }),
            ];
        case 'random': {
            // Seed the RNG from the cycle's start beat so the same insertion
            // reproduces the same points across CRDT collaborators — matching the
            // deterministic (Mulberry32) stance computeModulatorValue took for the
            // same reason. A bare Math.random() here would make two collaborators
            // diverge on a merge.
            const count = 8;
            const rng = createSeededRandom(Math.round(startBeat * 1000));
            const points: AutomationPoint[] = [];
            for (let pointIndex = 0; pointIndex <= count; pointIndex++) {
                points.push(makePoint({ beat: startBeat + (pointIndex / count) * duration, norm: rng() }));
            }
            return points;
        }
        default:
            return [];
    }
}

/**
 * The merge epsilon a generated shape hands `batchAddAutomationPoints`: half
 * the batch's own smallest adjacent beat gap, capped at the freehand default.
 * Generated shapes space their points by a fraction of the cycle (sine a
 * quarter, random an eighth), so a short range or many cycles puts neighbours
 * closer than the 0.05-beat freehand-jitter window and the batch would
 * collapse onto one point, landing fewer points than the shape requested.
 * Halving the smallest gap keeps every generated point distinct — the merge
 * window is open, so a gap of exactly twice the epsilon never matches — while
 * the cap preserves the freehand dedup against pre-existing points wherever
 * the generated spacing is wider than it. A zero gap must not zero the
 * epsilon, because the merge windows are open and a zero epsilon merges
 * nothing — coincident generated points are left to the freehand default.
 */
function shapeMergeEpsilon(points: readonly AutomationPoint[]): number {
    let minGap = Infinity;
    for (let index = 1; index < points.length; index += 1) {
        const gap = points[index]!.beat - points[index - 1]!.beat;
        if (gap < minGap) {
            minGap = gap;
        }
    }
    return Number.isFinite(minGap) && minGap > 0
        ? Math.min(DEFAULT_BEAT_MERGE_EPSILON, minGap / 2)
        : DEFAULT_BEAT_MERGE_EPSILON;
}

/**
 * Insert a predefined automation shape into a lane at a given beat range.
 * Uses the lane's min/max values to scale the shape vertically.
 *
 * The top of that scaling is {@link getAutomationLaneCeiling}, not the stored
 * `maxValue`: a gain lane written before the fader gained its `+6 dB` of
 * headroom still records `1` there, and reading the scalar would give the same
 * project the same shape at two different depths depending on when its lane was
 * created. The lane's travel is what the fader can reach, so that is what a
 * full-depth shape spans.
 */
export function insertAutomationShape(
    laneId: string,
    shape: AutomationShapeType,
    startBeat: number,
    endBeat: number,
    cycles = 1
): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((length) => length.id === laneId);
    if (!lane) {
        return;
    }

    const cycleDuration = (endBeat - startBeat) / cycles;
    const allPoints: AutomationPoint[] = [];

    for (let cycleIndex = 0; cycleIndex < cycles; cycleIndex++) {
        const cycleStart = startBeat + cycleIndex * cycleDuration;
        const cycleEnd = cycleStart + cycleDuration;
        const points = generateAutomationShapePoints({
            shape,
            startBeat: cycleStart,
            endBeat: cycleEnd,
            minValue: lane.minValue,
            maxValue: getAutomationLaneCeiling(lane),
        });
        // Skip the last point of each cycle except the final one to avoid duplicates at boundaries
        const pointCount = cycleIndex < cycles - 1 ? points.length - 1 : points.length;
        for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
            allPoints.push(points[pointIndex]!);
        }
    }

    batchAddAutomationPoints(laneId, allPoints, shapeMergeEpsilon(allPoints));
}
