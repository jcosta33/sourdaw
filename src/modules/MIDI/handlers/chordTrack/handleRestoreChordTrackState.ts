import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type HandlerDescribeResult,
    type HandlerSessionActionEntry,
    type HandlerValidationContext,
} from '#/utils/handlerContract';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { CHORD_TYPES } from '../../models/ChordTypes';
import { chordTrackStore, type ChordTrackState } from '../../stores/chordTrackStore';
import { cloneChordTrackState } from '../../transformers/cloneChordTrackState';
import { type ChordMutationAction, isChordTrackEditAction } from '../../transformers/isChordTrackEditAction';
import { projectChordTrackAction } from '../../transformers/projectChordTrackAction';
import { moveChordEvent } from '../../useCases/chordTrack/moveChordEvent';
import { projectChordTrackThroughActions } from '../../useCases/chordTrack/projectChordTrackState';
import { updateChordEvent } from '../../useCases/chordTrack/updateChordEvent';

function projectLiveState(state: ChordTrackState, context?: HandlerValidationContext): ChordTrackState {
    return context ? projectChordTrackThroughActions(state, context.actions.slice(0, context.actionIndex)) : state;
}

export function describeChordTrackMutation(
    action: ChordMutationAction,
    label: string,
    context?: HandlerValidationContext
): HandlerDescribeResult {
    const live = chordTrackStore.value;
    if (!live) {
        return { label, inverseAction: null };
    }
    const before = projectLiveState(live, context);
    const expected = projectChordTrackAction(before, action);
    return {
        label,
        inverseAction: {
            type: 'restoreChordTrackState',
            payload: { expected, replacement: cloneChordTrackState(before) },
        },
    };
}

export function isChordTrackMutationNoop(action: ChordMutationAction): boolean {
    const state = chordTrackStore.value;
    return !state || jsonValuesEqual(state, projectChordTrackAction(state, action));
}

/** Why a chord-track edit cannot be admitted into its batch, or null when it can. */
export function findChordTrackRefusal(action: ChordMutationAction, context: HandlerValidationContext): string | null {
    const live = chordTrackStore.value;
    if (!live) {
        return 'The project has no chord track';
    }
    if (action.type !== 'addChordEvent') {
        return null;
    }
    const state = projectLiveState(live, context);
    if (action.payload.eventId !== undefined && state.events.some((event) => event.id === action.payload.eventId)) {
        return `Chord event "${action.payload.eventId}" already exists`;
    }
    return null;
}

function findRestoreConflict(
    action: Extract<AppAction, { type: 'restoreChordTrackState' }>,
    context?: HandlerValidationContext
): string | null {
    const live = chordTrackStore.value;
    if (!live) {
        return 'The project has no chord track';
    }
    if (!jsonValuesEqual(projectLiveState(live, context), action.payload.expected)) {
        return 'The chord track changed after the edit this restores';
    }
    return null;
}

/**
 * A saved chord-track edit is replayable only when its undo restores the track the edit read, guarded by
 * exactly the track the edit wrote: the stored result must be what the action yields for the stored source,
 * so a stale or tampered entry is dropped, and an undo over a chord edited since refuses at execution.
 */
export function isChordTrackSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (redoAction !== undefined || inverseAction?.type !== 'restoreChordTrackState') {
        return false;
    }
    if (!isChordTrackEditAction(action) || !isChordTrackRestorePayload(inverseAction.payload)) {
        return false;
    }
    if (action.type === 'addChordEvent' && !action.payload.eventId) {
        return false;
    }
    const { expected, replacement } = inverseAction.payload;
    return jsonValuesEqual(projectChordTrackAction(cloneChordTrackState(replacement), action), expected);
}

export const handleMoveChordEvent = createHandler<'moveChordEvent'>({
    execute: (action) => moveChordEvent(action.payload.eventId, action.payload.beat),
    describe: (action) => describeChordTrackMutation(action, 'Move chord event'),
    isNoop: isChordTrackMutationNoop,
    undoable: true,
});

export const handleUpdateChordEvent = createHandler<'updateChordEvent'>({
    execute: (action) => updateChordEvent(action.payload.eventId, action.payload),
    describe: (action) => describeChordTrackMutation(action, 'Update chord event'),
    isNoop: isChordTrackMutationNoop,
    undoable: true,
});

type ChordTrackSnapshot = Extract<AppAction, { type: 'restoreChordTrackState' }>['payload']['expected'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isBeatNumber(value: unknown, minimum: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum;
}

function isChordEventSnapshot(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        isBeatNumber(value.beat, 0) &&
        isBeatNumber(value.root, 0) &&
        Number.isInteger(value.root) &&
        value.root <= 11 &&
        typeof value.quality === 'string' &&
        Object.hasOwn(CHORD_TYPES, value.quality) &&
        isBeatNumber(value.duration, 0.25)
    );
}

function isChordTrackSnapshot(value: unknown): value is ChordTrackSnapshot {
    return (
        isRecord(value) &&
        typeof value.enabled === 'boolean' &&
        Array.isArray(value.events) &&
        value.events.every(isChordEventSnapshot)
    );
}

function isChordTrackRestorePayload(payload: unknown): boolean {
    return isRecord(payload) && isChordTrackSnapshot(payload.expected) && isChordTrackSnapshot(payload.replacement);
}

export const handleRestoreChordTrackState = createHandler<'restoreChordTrackState'>({
    execute: (action) => {
        if (findRestoreConflict(action) !== null) {
            return { status: 'conflict' };
        }
        chordTrackStore.set(cloneChordTrackState(action.payload.replacement));
        return { status: 'written' };
    },
    validate: (action, context) => findRestoreConflict(action, context) === null,
    validationRefusalReason: findRestoreConflict,
    // Every restore names the state it expects, so it may be replayed as compensation only while that state holds.
    canReapplyAfterDivergence: (action, context) => findRestoreConflict(action, context) === null,
    // An undo refuses rather than overwrite a chord edit made since: the restore names the state it expects.
    canReportConflict: true,
    validateSessionActionArguments: isChordTrackRestorePayload,
    describe: (action) => ({
        label: 'Restore chord track state',
        inverseAction: {
            type: 'restoreChordTrackState',
            payload: { expected: action.payload.replacement, replacement: action.payload.expected },
        },
    }),
    undoable: true,
});
