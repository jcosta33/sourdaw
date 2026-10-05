import { readMusicalRange } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerDescribeResult, type HandlerValidationContext } from '#/utils/handlerContract';

import { automateParameterRange } from '../../useCases/automateParameterRange';
import { planParameterRangeWrite } from '../../useCases/automation/planParameterRangeWrite';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type AutomateParameterRangeAction = Extract<AppAction, { type: 'automateParameterRange' }>;

function ensureWriteId(action: AutomateParameterRangeAction): string {
    if (action.payload.writeId) {
        return action.payload.writeId;
    }
    const writeId = `automation-range-${crypto.randomUUID()}`;
    action.payload.writeId = writeId;
    return writeId;
}

function planWrite(action: AutomateParameterRangeAction): ReturnType<typeof planParameterRangeWrite> {
    return planParameterRangeWrite({ payload: action.payload, writeId: ensureWriteId(action) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function namesTrack(payload: Record<string, unknown>, trackId: string): boolean {
    return payload.trackId === trackId || (Array.isArray(payload.trackIds) && payload.trackIds.includes(trackId));
}

type RangeReadTarget = {
    trackId: string;
    parameterId: string;
    laneId: string | undefined;
    deviceId: string | null;
};

function changesWhatRangeReads(candidate: AppAction, target: RangeReadTarget): boolean {
    const payload: unknown = 'payload' in candidate ? candidate.payload : undefined;
    if (!isRecord(payload)) {
        return false;
    }
    if (candidate.type === 'automateParameterRange' || candidate.type === 'addAutomationLane') {
        return payload.trackId === target.trackId && payload.parameterId === target.parameterId;
    }
    if (target.laneId !== undefined && payload.laneId === target.laneId) {
        return true;
    }
    return namesTrack(payload, target.trackId) || (target.deviceId !== null && payload.deviceId === target.deviceId);
}

/** The device a `<deviceId>:<paramId>` target names, or null for a track or send target. */
function targetDeviceId(parameterId: string): string | null {
    const separatorIndex = parameterId.indexOf(':');
    return separatorIndex > 0 && !parameterId.startsWith('send:') ? parameterId.slice(0, separatorIndex) : null;
}

/**
 * Whether an earlier member of this batch changes something this write reads: its own lane, the
 * track whose level, pan, sends, mode or devices set the values it ramps from, or the device it
 * targets. A batch describes every member before any of them runs, so this write would otherwise
 * plan against a project those members are about to change and capture an inverse that does not
 * undo what it actually wrote. Another range write or lane on a different parameter of the same
 * track reads nothing this one does and is admitted.
 */
function findEarlierBatchConflict(
    action: AutomateParameterRangeAction,
    context: HandlerValidationContext | undefined
): string | null {
    const { trackId, parameterId } = action.payload;
    const target: RangeReadTarget = {
        trackId,
        parameterId,
        laneId: getAutomationStoreState()?.lanes.find(
            (lane) => !lane.clipId && lane.trackId === trackId && lane.parameterId === parameterId
        )?.id,
        deviceId: targetDeviceId(parameterId),
    };
    const conflicting = context?.actions
        .slice(0, context.actionIndex)
        .find((candidate) => changesWhatRangeReads(candidate, target));
    if (conflicting === undefined) {
        return null;
    }
    return `An earlier ${conflicting.type} in this batch changes what the ${parameterId} range on track ${trackId} is measured against; send them as separate requests.`;
}

function findRefusal(action: AutomateParameterRangeAction, context: HandlerValidationContext): string | null {
    const batchConflict = findEarlierBatchConflict(action, context);
    if (batchConflict !== null) {
        return batchConflict;
    }
    const planned = planWrite(action);
    return planned.status === 'refused' ? planned.reason : null;
}

function describeBeat(beat: number): string {
    return String(Number(beat.toFixed(3)));
}

/**
 * Undo puts the lane back exactly as it was, and only while it still holds exactly what this
 * write left: a lane the write created goes away with its points, and a lane it rewrote gets its
 * old points back. Redo replays the write itself, which reaches the same points from the same
 * state because the points carry the write's own identity.
 */
function describeAutomateParameterRange(action: AutomateParameterRangeAction): HandlerDescribeResult {
    const planned = planWrite(action);
    if (planned.status !== 'planned') {
        return { label: 'Automate parameter range', inverseAction: null };
    }
    const label = `Automate ${planned.parameterName} over beats ${describeBeat(planned.startBeat)}–${describeBeat(planned.endBeat)}`;
    if (planned.creation !== null) {
        return {
            label,
            inverseAction: {
                type: 'removeAutomationLane',
                payload: { laneId: planned.laneId, expectedPoints: planned.pointsAfter },
            },
        };
    }
    return {
        label,
        inverseAction: {
            type: 'restoreAutomationLanePoints',
            payload: { laneId: planned.laneId, points: planned.pointsBefore, expectedPoints: planned.pointsAfter },
        },
    };
}

export const handleAutomateParameterRange = createHandler<'automateParameterRange'>({
    // The range a person names is resolved to beats when the command is admitted, so every scope
    // and lock check downstream reads the beats this write will actually cover. Derived fields are
    // dropped first: they are the application's, never the caller's.
    materializeCommandArguments: (action) => {
        delete action.payload.startBeat;
        delete action.payload.endBeat;
        const resolution = readMusicalRange({ range: action.payload.range });
        if (resolution.kind !== 'resolved') {
            return;
        }
        action.payload.startBeat = resolution.startBeat;
        action.payload.endBeat = resolution.endBeat;
    },
    materializeCommandArgumentsAt: 'admission',
    validate: (action, context) => findRefusal(action, context) === null,
    validationRefusalReason: findRefusal,
    execute: (action) => {
        const result = automateParameterRange({ payload: action.payload, writeId: ensureWriteId(action) });
        return result.status === 'planned' ? { status: 'written' } : { status: 'conflict', reason: result.reason };
    },
    describe: describeAutomateParameterRange,
    canReportConflict: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
