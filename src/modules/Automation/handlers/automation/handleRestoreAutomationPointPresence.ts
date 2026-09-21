import { createHandler } from '#/utils/createHandler';
import { type AppAction, type AutomationPointSnapshot } from '#/utils/handlerContract';

import { type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { is_exact_automation_point } from '../../stores/automationStore';
import { restoreAutomationPointPresence } from '../../useCases/automation/restoreAutomationPointPresence';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type ReplayAction = Extract<AppAction, { type: 'restoreAutomationPointPresence' }>;
type ValidatedReplayPayload = Omit<ReplayAction['payload'], 'point'> & { point: AutomationPoint };

function pointsMatch(point: AutomationPoint, expected: AutomationPointSnapshot): boolean {
    return (
        point.id === expected.id &&
        point.beat === expected.beat &&
        point.value === expected.value &&
        point.curve === expected.curve &&
        point.tension === expected.tension &&
        point.stairSteps === expected.stairSteps &&
        point.cp1?.x === expected.cp1?.x &&
        point.cp1?.y === expected.cp1?.y &&
        point.cp2?.x === expected.cp2?.x &&
        point.cp2?.y === expected.cp2?.y
    );
}

function ownerMatches(lane: AutomationLane, action: ReplayAction): boolean {
    const owner = action.payload.owner;
    return (
        lane.trackId === owner.trackId &&
        lane.parameterId === owner.parameterId &&
        lane.clipId === owner.clipId &&
        lane.linkedLaneId === owner.linkedLaneId
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidOwner(owner: unknown): owner is ValidatedReplayPayload['owner'] {
    if (!isRecord(owner)) {
        return false;
    }
    const allowedKeys = new Set(['trackId', 'parameterId', 'clipId', 'linkedLaneId']);
    return (
        typeof owner.trackId === 'string' &&
        typeof owner.parameterId === 'string' &&
        typeof owner.linkedLaneId === 'string' &&
        (!Object.hasOwn(owner, 'clipId') || typeof owner.clipId === 'string') &&
        Object.keys(owner).every((key) => allowedKeys.has(key))
    );
}

function isPresence(value: unknown): value is 'present' | 'absent' {
    return value === 'present' || value === 'absent';
}

function isValidPayload(payload: unknown): payload is ValidatedReplayPayload {
    if (!isRecord(payload) || !isValidOwner(payload.owner) || !is_exact_automation_point(payload.point)) {
        return false;
    }
    return (
        Object.keys(payload).length === 6 &&
        Object.hasOwn(payload, 'laneId') &&
        Object.hasOwn(payload, 'owner') &&
        Object.hasOwn(payload, 'point') &&
        Object.hasOwn(payload, 'equalBeatIndex') &&
        Object.hasOwn(payload, 'expectedPresence') &&
        Object.hasOwn(payload, 'replacementPresence') &&
        typeof payload.laneId === 'string' &&
        Number.isInteger(payload.equalBeatIndex) &&
        (payload.equalBeatIndex as number) >= 0 &&
        isPresence(payload.expectedPresence) &&
        isPresence(payload.replacementPresence) &&
        payload.expectedPresence !== payload.replacementPresence
    );
}

function resolveMatch(action: ReplayAction): { lane: AutomationLane; matchedIndex: number } | null {
    const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
    if (!lane || !ownerMatches(lane, action)) {
        return null;
    }
    const point = action.payload.point;
    const candidateIndexes = lane.points.flatMap((candidate, index) => {
        if (point.id !== undefined) {
            return candidate.id === point.id ? [index] : [];
        }
        return pointsMatch(candidate, point) ? [index] : [];
    });
    if (candidateIndexes.length > 1) {
        return null;
    }
    const matchedIndex = candidateIndexes[0] ?? -1;
    if (matchedIndex >= 0 && !pointsMatch(lane.points[matchedIndex]!, point)) {
        return null;
    }
    if (point.id === undefined && matchedIndex < 0 && lane.points.some((candidate) => candidate.beat === point.beat)) {
        return null;
    }
    const isPresent = matchedIndex >= 0;
    if ((action.payload.expectedPresence === 'present') !== isPresent) {
        return null;
    }
    return { lane, matchedIndex };
}

export const handleRestoreAutomationPointPresence = createHandler<'restoreAutomationPointPresence'>({
    execute: (action) => {
        const payload = action.payload;
        if (!isValidPayload(payload)) {
            return { status: 'conflict' };
        }
        const resolved = resolveMatch(action);
        if (!resolved) {
            return { status: 'conflict' };
        }
        restoreAutomationPointPresence({
            laneId: action.payload.laneId,
            point: payload.point,
            equalBeatIndex: payload.equalBeatIndex,
            replacementPresence: payload.replacementPresence,
            matchedIndex: resolved.matchedIndex,
        });
        return { status: 'written' };
    },
    canReportConflict: true,
    describe: () => ({ label: 'Restore automation point' }),
    validateSessionActionArguments: isValidPayload,
    undoable: false,
});
