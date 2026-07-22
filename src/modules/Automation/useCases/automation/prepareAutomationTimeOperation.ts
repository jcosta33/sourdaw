import { automationStore, type AutomationStoreState } from '../../stores/automationStore';

import type { AutomationLane, AutomationPoint } from '../../models/Automation';

type InsertAutomationTimeOperation = {
    type: 'insert';
    atBeat: number;
    durationBeats: number;
};

type DeleteAutomationTimeOperation = {
    type: 'delete';
    startBeat: number;
    endBeat: number;
};

type AutomationTimeOperation = InsertAutomationTimeOperation | DeleteAutomationTimeOperation;

type AutomationOwnerSnapshot = {
    trackId: string;
    eligible: boolean;
    clipIds: readonly string[];
};

type PrepareAutomationTimeOperationInput = {
    operation: AutomationTimeOperation;
    owners: readonly AutomationOwnerSnapshot[];
};

type IndexedAutomationOwner = {
    eligible: boolean;
    clipIds: ReadonlySet<string>;
};

type PreparedPoints = { status: 'invalid' } | { status: 'valid'; hasChanges: boolean; points: AutomationPoint[] };

type PreparedAutomationState = {
    hasChanges: boolean;
    nextState: AutomationStoreState | null;
};

type TransactionPhase = 'prepared' | 'applied' | 'closed';

function isFiniteNonNegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function isValidOperation(operation: AutomationTimeOperation): boolean {
    if (operation.type === 'insert') {
        return (
            isFiniteNonNegative(operation.atBeat) &&
            Number.isFinite(operation.durationBeats) &&
            operation.durationBeats > 0
        );
    }

    return (
        isFiniteNonNegative(operation.startBeat) &&
        Number.isFinite(operation.endBeat) &&
        operation.endBeat > operation.startBeat
    );
}

function createOwnerIndex(
    owners: readonly AutomationOwnerSnapshot[]
): ReadonlyMap<string, IndexedAutomationOwner> | null {
    const ownersByTrackId = new Map<string, IndexedAutomationOwner>();
    const clipOwnerById = new Map<string, string>();

    for (const owner of owners) {
        const runtimeTrackId: unknown = owner.trackId;
        const runtimeEligible: unknown = owner.eligible;
        const runtimeClipIds: unknown = owner.clipIds;
        if (
            typeof runtimeTrackId !== 'string' ||
            runtimeTrackId.trim().length === 0 ||
            ownersByTrackId.has(runtimeTrackId)
        ) {
            return null;
        }
        if (typeof runtimeEligible !== 'boolean' || !Array.isArray(runtimeClipIds)) {
            return null;
        }

        const clipIds = new Set<string>();
        for (const clipId of runtimeClipIds) {
            if (
                typeof clipId !== 'string' ||
                clipId.trim().length === 0 ||
                clipIds.has(clipId) ||
                clipOwnerById.has(clipId)
            ) {
                return null;
            }
            clipIds.add(clipId);
            clipOwnerById.set(clipId, runtimeTrackId);
        }

        ownersByTrackId.set(runtimeTrackId, {
            eligible: runtimeEligible,
            clipIds,
        });
    }

    return ownersByTrackId;
}

function prepareInsertedPoints(
    points: readonly AutomationPoint[],
    operation: InsertAutomationTimeOperation
): PreparedPoints {
    let hasChanges = false;
    const nextPoints: AutomationPoint[] = [];

    for (const automationPoint of points) {
        if (automationPoint.beat < operation.atBeat) {
            nextPoints.push(automationPoint);
            continue;
        }

        const shiftedBeat = automationPoint.beat + operation.durationBeats;
        if (!isFiniteNonNegative(shiftedBeat)) {
            return { status: 'invalid' };
        }

        hasChanges = true;
        nextPoints.push({ ...automationPoint, beat: shiftedBeat });
    }

    return {
        status: 'valid',
        hasChanges,
        points: nextPoints,
    };
}

function prepareDeletedPoints(
    points: readonly AutomationPoint[],
    operation: DeleteAutomationTimeOperation
): PreparedPoints {
    const durationBeats = operation.endBeat - operation.startBeat;
    let hasChanges = false;
    const nextPoints: AutomationPoint[] = [];

    for (const automationPoint of points) {
        if (automationPoint.beat >= operation.startBeat && automationPoint.beat < operation.endBeat) {
            hasChanges = true;
            continue;
        }
        if (automationPoint.beat < operation.endBeat) {
            nextPoints.push(automationPoint);
            continue;
        }

        const shiftedBeat = automationPoint.beat - durationBeats;
        if (!isFiniteNonNegative(shiftedBeat)) {
            return { status: 'invalid' };
        }

        hasChanges = true;
        nextPoints.push({ ...automationPoint, beat: shiftedBeat });
    }

    return {
        status: 'valid',
        hasChanges,
        points: nextPoints,
    };
}

function prepareLanePoints(lane: AutomationLane, operation: AutomationTimeOperation): PreparedPoints {
    if (operation.type === 'insert') {
        return prepareInsertedPoints(lane.points, operation);
    }
    return prepareDeletedPoints(lane.points, operation);
}

function prepareNextState(
    preparedState: AutomationStoreState | null,
    operation: AutomationTimeOperation,
    owners: readonly AutomationOwnerSnapshot[]
): PreparedAutomationState {
    if (!preparedState || !isValidOperation(operation)) {
        return {
            hasChanges: false,
            nextState: preparedState,
        };
    }

    const ownersByTrackId = createOwnerIndex(owners);
    if (!ownersByTrackId) {
        return {
            hasChanges: false,
            nextState: preparedState,
        };
    }

    let hasChanges = false;
    const lanes: AutomationLane[] = [];
    for (const lane of preparedState.lanes) {
        const owner = ownersByTrackId.get(lane.trackId);
        if (!owner) {
            return {
                hasChanges: false,
                nextState: preparedState,
            };
        }
        if (lane.clipId !== undefined && !owner.clipIds.has(lane.clipId)) {
            return {
                hasChanges: false,
                nextState: preparedState,
            };
        }
        if (!owner.eligible) {
            lanes.push(lane);
            continue;
        }

        const preparedPoints = prepareLanePoints(lane, operation);
        if (preparedPoints.status === 'invalid') {
            return {
                hasChanges: false,
                nextState: preparedState,
            };
        }
        if (!preparedPoints.hasChanges) {
            lanes.push(lane);
            continue;
        }

        hasChanges = true;
        lanes.push({
            ...lane,
            points: preparedPoints.points,
        });
    }

    if (!hasChanges) {
        return {
            hasChanges: false,
            nextState: preparedState,
        };
    }

    return {
        hasChanges: true,
        nextState: {
            ...preparedState,
            lanes,
        },
    };
}

export function prepareAutomationTimeOperation({ operation, owners }: PrepareAutomationTimeOperationInput) {
    const preparedState = automationStore.value;
    const preparedOperation = prepareNextState(preparedState, operation, owners);
    let phase: TransactionPhase = preparedOperation.hasChanges ? 'prepared' : 'closed';

    function apply(): boolean {
        if (phase !== 'prepared') {
            return false;
        }
        if (!preparedState || !preparedOperation.nextState) {
            phase = 'closed';
            return false;
        }
        if (automationStore.value !== preparedState) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        automationStore.set(preparedOperation.nextState);
        if (automationStore.value !== preparedOperation.nextState) {
            return false;
        }

        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase !== 'applied') {
            return false;
        }
        if (!preparedState || !preparedOperation.nextState) {
            phase = 'closed';
            return false;
        }
        if (automationStore.value !== preparedOperation.nextState) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        automationStore.set(preparedState);
        return automationStore.value === preparedState;
    }

    return {
        hasChanges: preparedOperation.hasChanges,
        apply,
        revert,
    };
}
