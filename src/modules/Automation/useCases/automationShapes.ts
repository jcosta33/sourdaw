import { generateShapePoints } from '#/modules/Arrangement/useCases';

import { automationStore } from '../stores/automationStore';

import { batchAddAutomationPoints } from './automation/batchAddAutomationPoints';

// Local shape (AGENTS.md model isolation). Structurally compatible with what
// Arrangement's `generateShapePoints` accepts; we do not import the type from
// another module's transformer or use case surface.
export type AutomationShapeType = 'sine' | 'triangle' | 'sawtooth-up' | 'sawtooth-down' | 'square' | 'random';

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
    const allPoints = [];

    for (let context = 0; context < cycles; context++) {
        const cycleStart = startBeat + context * cycleDuration;
        const cycleEnd = cycleStart + cycleDuration;
        const points = generateShapePoints(shape, cycleStart, cycleEnd, lane.minValue, lane.maxValue);
        // Skip the last point of each cycle except the final one to avoid duplicates at boundaries
        const end = context < cycles - 1 ? points.length - 1 : points.length;
        for (let index = 0; index < end; index++) {
            allPoints.push(points[index]!);
        }
    }

    batchAddAutomationPoints(laneId, allPoints);
}
