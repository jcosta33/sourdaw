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

type PreparationStatus = 'ready' | 'rejected';

type PreparedAutomationState = {
    status: PreparationStatus;
    hasChanges: boolean;
    nextState: AutomationStoreState | null;
};

type TransactionPhase = 'prepared' | 'applied' | 'closed';

function isFiniteNonNegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function validateOperation(operation: unknown): AutomationTimeOperation | null {
    if (!isPlainObject(operation)) {
        return null;
    }

    if (operation.type === 'insert') {
        const atBeat = operation.atBeat;
        const durationBeats = operation.durationBeats;
        if (typeof atBeat !== 'number' || !isFiniteNonNegative(atBeat)) {
            return null;
        }
        if (typeof durationBeats !== 'number' || !Number.isFinite(durationBeats) || durationBeats <= 0) {
            return null;
        }

        return {
            type: 'insert',
            atBeat,
            durationBeats,
        };
    }

    if (operation.type === 'delete') {
        const startBeat = operation.startBeat;
        const endBeat = operation.endBeat;
        if (typeof startBeat !== 'number' || !isFiniteNonNegative(startBeat)) {
            return null;
        }
        if (typeof endBeat !== 'number' || !Number.isFinite(endBeat) || endBeat <= startBeat) {
            return null;
        }

        return {
            type: 'delete',
            startBeat,
            endBeat,
        };
    }

    return null;
}

function createOwnerIndex(owners: unknown): ReadonlyMap<string, IndexedAutomationOwner> | null {
    if (!Array.isArray(owners)) {
        return null;
    }

    const ownersByTrackId = new Map<string, IndexedAutomationOwner>();
    const clipOwnerById = new Map<string, string>();

    for (const owner of owners) {
        if (!isPlainObject(owner)) {
            return null;
        }

        const runtimeTrackId = owner.trackId;
        const runtimeEligible = owner.eligible;
        const runtimeClipIds = owner.clipIds;
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

function validateInput(input: unknown): {
    operation: AutomationTimeOperation;
    ownersByTrackId: ReadonlyMap<string, IndexedAutomationOwner>;
} | null {
    if (!isPlainObject(input)) {
        return null;
    }

    const operation = validateOperation(input.operation);
    if (!operation) {
        return null;
    }

    const ownersByTrackId = createOwnerIndex(input.owners);
    if (!ownersByTrackId) {
        return null;
    }

    return {
        operation,
        ownersByTrackId,
    };
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
        if (shiftedBeat === automationPoint.beat) {
            nextPoints.push(automationPoint);
            continue;
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
        if (shiftedBeat === automationPoint.beat) {
            nextPoints.push(automationPoint);
            continue;
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
    ownersByTrackId: ReadonlyMap<string, IndexedAutomationOwner>
): PreparedAutomationState {
    if (!preparedState) {
        return {
            status: 'rejected',
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
                status: 'rejected',
                hasChanges: false,
                nextState: preparedState,
            };
        }
        if (lane.clipId !== undefined && !owner.clipIds.has(lane.clipId)) {
            return {
                status: 'rejected',
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
                status: 'rejected',
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
            status: 'ready',
            hasChanges: false,
            nextState: preparedState,
        };
    }

    return {
        status: 'ready',
        hasChanges: true,
        nextState: {
            ...preparedState,
            lanes,
        },
    };
}

export function prepareAutomationTimeOperation(input: PrepareAutomationTimeOperationInput) {
    const preparedState = automationStore.value;
    const validatedInput = validateInput(input);
    let preparedOperation: PreparedAutomationState;
    if (!validatedInput) {
        preparedOperation = {
            status: 'rejected',
            hasChanges: false,
            nextState: preparedState,
        };
    } else {
        preparedOperation = prepareNextState(preparedState, validatedInput.operation, validatedInput.ownersByTrackId);
    }
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
        status: preparedOperation.status,
        hasChanges: preparedOperation.hasChanges,
        apply,
        revert,
    };
}
