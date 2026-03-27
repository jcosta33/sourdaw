import { type AutomationShapeType, generateShapePoints } from '#/modules/Arrangement/useCases/automationQueries';
import { batchAddAutomationPoints } from './automation/batchAddAutomationPoints';
import { automationStore } from '../stores/automationStore';

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

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return;
    }

    const cycleDuration = (endBeat - startBeat) / cycles;
    const allPoints = [];

    for (let c = 0; c < cycles; c++) {
        const cycleStart = startBeat + c * cycleDuration;
        const cycleEnd = cycleStart + cycleDuration;
        const points = generateShapePoints(shape, cycleStart, cycleEnd, lane.minValue, lane.maxValue);
        // Remove the last point of each cycle except the final one to avoid duplicates
        if (c < cycles - 1) {
            points.pop();
        }
        allPoints.push(...points);
    }

    batchAddAutomationPoints(laneId, allPoints);
}

export type { AutomationShapeType };
