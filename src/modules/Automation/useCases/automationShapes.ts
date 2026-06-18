import { type AutomationPoint } from '../models/Automation';
import { automationStore } from '../stores/automationStore';

import { batchAddAutomationPoints } from './automation/batchAddAutomationPoints';

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
            const count = 8;
            const points: AutomationPoint[] = [];
            for (let pointIndex = 0; pointIndex <= count; pointIndex++) {
                points.push(makePoint({ beat: startBeat + (pointIndex / count) * duration, norm: Math.random() }));
            }
            return points;
        }
        default:
            return [];
    }
}

/**
 * Insert a predefined automation shape into a lane at a given beat range.
 * Uses the lane's min/max values to scale the shape vertically.
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
            maxValue: lane.maxValue,
        });
        // Skip the last point of each cycle except the final one to avoid duplicates at boundaries
        const pointCount = cycleIndex < cycles - 1 ? points.length - 1 : points.length;
        for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
            allPoints.push(points[pointIndex]!);
        }
    }

    batchAddAutomationPoints(laneId, allPoints);
}
