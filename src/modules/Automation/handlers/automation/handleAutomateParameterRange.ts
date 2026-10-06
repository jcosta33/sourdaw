import { readMusicalRange, readMusicalRangeInputs } from '#/modules/Arrangement/stores';
import { getExecutableAppActionEffect } from '#/modules/Command/useCases';
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
type ActionEffect = NonNullable<ReturnType<typeof getExecutableAppActionEffect>>;
type RangeInput = ReturnType<typeof readMusicalRangeInputs>[number];
type EffectObject = NonNullable<ActionEffect['creates']>[number];

/** The arrangement objects whose creation or removal moves each input a named range is read against. */
const OBJECTS_MOVING_INPUT: Record<Exclude<RangeInput, 'meter'>, readonly EffectObject[]> = {
    places: ['marker', 'section'],
    'arrangement-end': ['clip'],
};

/**
 * Whether an earlier member can move an input the range is read against. An arrangement edit that
 * creates or removes nothing — a move, a trim, a rename — is read as able to move any of them, and
 * a member Command declares no effect for is read as able to move everything.
 */
function movesRangeInput(candidate: AppAction, input: RangeInput): boolean {
    const effect = getExecutableAppActionEffect(candidate.type);
    if (effect === null) {
        return true;
    }
    if (input === 'meter') {
        return effect.dimensions.includes('project-timing');
    }
    if (!effect.dimensions.includes('arrangement')) {
        return false;
    }
    const created: readonly EffectObject[] = effect.creates ?? [];
    const removed: readonly EffectObject[] = effect.removes ?? [];
    const touched = [...created, ...removed];
    return touched.length === 0 || touched.some((object) => OBJECTS_MOVING_INPUT[input].includes(object));
}

/**
 * Whether an earlier member of this batch can move the beats this range resolves to. The range is
 * resolved when the batch is admitted, before any member runs, and the production-brief lock guard
 * admits the batch against exactly those beats; resolving again at execution would write beats that
 * guard never saw, so such a batch is refused instead.
 */
function findEarlierRangeConflict(
    action: AutomateParameterRangeAction,
    context: HandlerValidationContext | undefined
): string | null {
    const earlier = context?.actions.slice(0, context.actionIndex) ?? [];
    if (earlier.length === 0) {
        return null;
    }
    const inputs = readMusicalRangeInputs({ range: action.payload.range });
    const moving = earlier.find((candidate) => inputs.some((input) => movesRangeInput(candidate, input)));
    if (moving === undefined) {
        return null;
    }
    return `An earlier ${moving.type} in this batch can move the beats the ${action.payload.parameterId} range is resolved to; send them as separate requests.`;
}

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
        return findEarlierRangeConflict(action, context);
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
