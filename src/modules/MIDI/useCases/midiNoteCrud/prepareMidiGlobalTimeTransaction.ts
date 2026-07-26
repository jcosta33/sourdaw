import { createMidiNote } from '../../models/MidiNote';
import {
    transformMidiGlobalTimeState,
    type MidiGeneratedNoteIdentityRequest,
    type MidiGlobalTimeCommand,
    type MidiGlobalTimeShiftClip,
} from '../../services/transformMidiGlobalTimeState';
import { midiStore, type MidiStoreState } from '../../stores/midiStore';

import { midiTimeStateCodec } from './midiTimeStateCodec';

type MidiGlobalTimeClipSnapshot = {
    clipId: string;
    startBeat: number;
    endBeat: number;
    midiOffsetBeats?: number;
};

type MidiGlobalTimeOwnerSnapshot = {
    trackId: string;
    eligible: boolean;
    clips: readonly MidiGlobalTimeClipSnapshot[];
};

type MidiGlobalTimeSplitOperation = {
    sourceClipId: string;
    newClipId: string;
    splitBeat: number;
    discardBeforeBeat?: number;
};

type MidiGlobalTimeCopyOperation = {
    sourceClipId: string;
    newClipId: string;
};

type InsertMidiGlobalTimeOperation = {
    type: 'insert';
    atBeat: number;
    durationBeats: number;
};

type DeleteMidiGlobalTimeOperation = {
    type: 'delete';
    startBeat: number;
    endBeat: number;
    splits: readonly MidiGlobalTimeSplitOperation[];
    removeClipIds: readonly string[];
};

type DuplicateMidiGlobalTimeOperation = {
    type: 'duplicate';
    startBeat: number;
    endBeat: number;
    copies: readonly MidiGlobalTimeCopyOperation[];
};

type MidiGlobalTimeOperation =
    InsertMidiGlobalTimeOperation | DeleteMidiGlobalTimeOperation | DuplicateMidiGlobalTimeOperation;

type MidiGlobalTimeReplayNote = MidiGeneratedNoteIdentityRequest & {
    targetNoteId: string;
};

type MidiGlobalTimeReplayPlan = {
    version: 1;
    notes: readonly MidiGlobalTimeReplayNote[];
};

type MidiTimeStateSnapshot = NonNullable<ReturnType<typeof midiTimeStateCodec.encodeState>>;

type MidiGlobalTimeStateRestorePlan = {
    version: 1;
    expected: MidiTimeStateSnapshot;
    replacement: MidiTimeStateSnapshot;
};

type MidiGlobalTimeStateSnapshots = {
    inversePlan: MidiGlobalTimeStateRestorePlan;
    nextValueSnapshot: MidiStoreState;
    preparedValueSnapshot: MidiStoreState;
};

type PrepareMidiGlobalTimeTransactionInput = {
    operation: MidiGlobalTimeOperation;
    owners: readonly MidiGlobalTimeOwnerSnapshot[];
    replayPlan?: MidiGlobalTimeReplayPlan;
};

type IndexedMidiClip = MidiGlobalTimeShiftClip;

type ValidatedPreparationInput = {
    operation: MidiGlobalTimeOperation;
    clipsById: ReadonlyMap<string, IndexedMidiClip>;
    suppliedReplayPlan: unknown;
};

type PreparedMidiGlobalTimeState = {
    status: 'ready' | 'rejected';
    hasChanges: boolean;
    nextState: MidiStoreState | null;
    replayPlan: MidiGlobalTimeReplayPlan;
};

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

const EMPTY_REPLAY_PLAN: MidiGlobalTimeReplayPlan = { version: 1, notes: [] };
const INPUT_KEYS = ['operation', 'owners'] as const;
const INPUT_WITH_REPLAY_PLAN_KEYS = ['operation', 'owners', 'replayPlan'] as const;
const OWNER_KEYS = ['trackId', 'eligible', 'clips'] as const;
const CLIP_KEYS = ['clipId', 'startBeat', 'endBeat'] as const;
const CLIP_WITH_MIDI_OFFSET_KEYS = ['clipId', 'startBeat', 'endBeat', 'midiOffsetBeats'] as const;
const INSERT_OPERATION_KEYS = ['type', 'atBeat', 'durationBeats'] as const;
const DELETE_OPERATION_KEYS = ['type', 'startBeat', 'endBeat', 'splits', 'removeClipIds'] as const;
const DUPLICATE_OPERATION_KEYS = ['type', 'startBeat', 'endBeat', 'copies'] as const;
const SPLIT_OPERATION_KEYS = ['sourceClipId', 'newClipId', 'splitBeat'] as const;
const SPLIT_WITH_DISCARD_KEYS = ['sourceClipId', 'newClipId', 'splitBeat', 'discardBeforeBeat'] as const;
const COPY_OPERATION_KEYS = ['sourceClipId', 'newClipId'] as const;
const REPLAY_PLAN_KEYS = ['version', 'notes'] as const;
const REPLAY_NOTE_KEYS = [
    'role',
    'sourceClipId',
    'sourceNoteId',
    'sourceNoteIndex',
    'targetClipId',
    'targetNoteId',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const valueKeys = Object.keys(value);
    return valueKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasExactKeysForOptionalProperty(
    value: Record<string, unknown>,
    optionalProperty: string,
    keysWithoutOptionalProperty: readonly string[],
    keysWithOptionalProperty: readonly string[]
): boolean {
    if (Object.hasOwn(value, optionalProperty)) {
        return hasExactKeys(value, keysWithOptionalProperty);
    }

    return hasExactKeys(value, keysWithoutOptionalProperty);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNonNegative(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function isNonEmptyId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function validateSplitOperation(value: unknown): MidiGlobalTimeSplitOperation | null {
    if (!isPlainObject(value)) {
        return null;
    }
    if (!hasExactKeysForOptionalProperty(value, 'discardBeforeBeat', SPLIT_OPERATION_KEYS, SPLIT_WITH_DISCARD_KEYS)) {
        return null;
    }

    const sourceClipId = value.sourceClipId;
    const newClipId = value.newClipId;
    const splitBeat = value.splitBeat;
    const discardBeforeBeat = value.discardBeforeBeat;
    if (!isNonEmptyId(sourceClipId) || !isNonEmptyId(newClipId) || !isFiniteNonNegative(splitBeat)) {
        return null;
    }
    if (Object.hasOwn(value, 'discardBeforeBeat')) {
        if (!isFiniteNonNegative(discardBeforeBeat) || discardBeforeBeat > splitBeat) {
            return null;
        }

        return { sourceClipId, newClipId, splitBeat, discardBeforeBeat };
    }

    return { sourceClipId, newClipId, splitBeat };
}

function validateCopyOperation(value: unknown): MidiGlobalTimeCopyOperation | null {
    if (!isPlainObject(value) || !hasExactKeys(value, COPY_OPERATION_KEYS)) {
        return null;
    }
    if (!isNonEmptyId(value.sourceClipId) || !isNonEmptyId(value.newClipId)) {
        return null;
    }

    return {
        sourceClipId: value.sourceClipId,
        newClipId: value.newClipId,
    };
}

function validateDeleteOperation(value: Record<string, unknown>): DeleteMidiGlobalTimeOperation | null {
    if (!hasExactKeys(value, DELETE_OPERATION_KEYS)) {
        return null;
    }

    const startBeat = value.startBeat;
    const endBeat = value.endBeat;
    if (!isFiniteNonNegative(startBeat) || !isFiniteNumber(endBeat) || endBeat <= startBeat) {
        return null;
    }
    if (!Array.isArray(value.splits) || !Array.isArray(value.removeClipIds)) {
        return null;
    }

    const splits: MidiGlobalTimeSplitOperation[] = [];
    for (const valueSplit of value.splits) {
        const split = validateSplitOperation(valueSplit);
        if (!split) {
            return null;
        }
        splits.push(split);
    }

    const removeClipIds: string[] = [];
    for (const clipId of value.removeClipIds) {
        if (!isNonEmptyId(clipId)) {
            return null;
        }
        removeClipIds.push(clipId);
    }

    return { type: 'delete', startBeat, endBeat, splits, removeClipIds };
}

function validateDuplicateOperation(value: Record<string, unknown>): DuplicateMidiGlobalTimeOperation | null {
    if (!hasExactKeys(value, DUPLICATE_OPERATION_KEYS)) {
        return null;
    }

    const startBeat = value.startBeat;
    const endBeat = value.endBeat;
    if (!isFiniteNonNegative(startBeat) || !isFiniteNumber(endBeat) || endBeat <= startBeat) {
        return null;
    }
    if (!Array.isArray(value.copies)) {
        return null;
    }

    const copies: MidiGlobalTimeCopyOperation[] = [];
    for (const valueCopy of value.copies) {
        const copy = validateCopyOperation(valueCopy);
        if (!copy) {
            return null;
        }
        copies.push(copy);
    }

    return { type: 'duplicate', startBeat, endBeat, copies };
}

function validateOperation(value: unknown): MidiGlobalTimeOperation | null {
    if (!isPlainObject(value)) {
        return null;
    }

    if (value.type === 'insert') {
        if (!hasExactKeys(value, INSERT_OPERATION_KEYS)) {
            return null;
        }
        if (!isFiniteNonNegative(value.atBeat) || !isFiniteNumber(value.durationBeats) || value.durationBeats <= 0) {
            return null;
        }
        const operationEndBeat = value.atBeat + value.durationBeats;
        if (!Number.isFinite(operationEndBeat)) {
            return null;
        }
        return { type: 'insert', atBeat: value.atBeat, durationBeats: value.durationBeats };
    }
    if (value.type === 'delete') {
        return validateDeleteOperation(value);
    }
    if (value.type === 'duplicate') {
        return validateDuplicateOperation(value);
    }

    return null;
}

function createClipIndex(owners: unknown): ReadonlyMap<string, IndexedMidiClip> | null {
    if (!Array.isArray(owners)) {
        return null;
    }

    const trackIds = new Set<string>();
    const clipsById = new Map<string, IndexedMidiClip>();
    for (const owner of owners) {
        if (!isPlainObject(owner) || !hasExactKeys(owner, OWNER_KEYS)) {
            return null;
        }

        const trackId = owner.trackId;
        const eligible = owner.eligible;
        const clips = owner.clips;
        if (!isNonEmptyId(trackId) || trackIds.has(trackId) || typeof eligible !== 'boolean' || !Array.isArray(clips)) {
            return null;
        }

        const ownerClipIds = new Set<string>();
        for (const clip of clips) {
            if (!isPlainObject(clip)) {
                return null;
            }
            if (!hasExactKeysForOptionalProperty(clip, 'midiOffsetBeats', CLIP_KEYS, CLIP_WITH_MIDI_OFFSET_KEYS)) {
                return null;
            }

            const clipId = clip.clipId;
            const startBeat = clip.startBeat;
            const endBeat = clip.endBeat;
            const midiOffsetBeats = clip.midiOffsetBeats;
            if (!isNonEmptyId(clipId) || ownerClipIds.has(clipId) || clipsById.has(clipId)) {
                return null;
            }
            if (!isFiniteNumber(startBeat) || !isFiniteNumber(endBeat) || endBeat <= startBeat) {
                return null;
            }
            let normalizedMidiOffsetBeats = 0;
            if (Object.hasOwn(clip, 'midiOffsetBeats')) {
                if (!isFiniteNumber(midiOffsetBeats)) {
                    return null;
                }
                normalizedMidiOffsetBeats = midiOffsetBeats;
            }

            ownerClipIds.add(clipId);
            clipsById.set(clipId, {
                clipId,
                eligible,
                startBeat,
                endBeat,
                midiOffsetBeats: normalizedMidiOffsetBeats,
            });
        }

        trackIds.add(trackId);
    }

    return clipsById;
}

function validateInput(input: unknown): ValidatedPreparationInput | null {
    if (!isPlainObject(input)) {
        return null;
    }
    if (!hasExactKeysForOptionalProperty(input, 'replayPlan', INPUT_KEYS, INPUT_WITH_REPLAY_PLAN_KEYS)) {
        return null;
    }

    const operation = validateOperation(input.operation);
    const clipsById = createClipIndex(input.owners);
    if (!operation || !clipsById) {
        return null;
    }

    return { operation, clipsById, suppliedReplayPlan: input.replayPlan };
}

function hasCompleteOwnership(state: MidiStoreState, clipsById: ReadonlyMap<string, IndexedMidiClip>): boolean {
    const dataMaps = [state.notesByClipId, state.ccByClipId, state.pitchBendByClipId];
    for (const dataMap of dataMaps) {
        for (const clipId of Object.keys(dataMap)) {
            if (!clipsById.has(clipId)) {
                return false;
            }
        }
    }
    return true;
}

function isEligibleTarget(clipId: string, clipsById: ReadonlyMap<string, IndexedMidiClip>): boolean {
    return clipsById.get(clipId)?.eligible === true;
}

function hasMidiData(state: MidiStoreState, clipId: string): boolean {
    return (
        Object.hasOwn(state.notesByClipId, clipId) ||
        Object.hasOwn(state.ccByClipId, clipId) ||
        Object.hasOwn(state.pitchBendByClipId, clipId)
    );
}

function createShiftCommand(
    clipsById: ReadonlyMap<string, IndexedMidiClip>,
    atBeat: number,
    beatDelta: number
): MidiGlobalTimeCommand {
    return { type: 'shift', atBeat, beatDelta, clips: [...clipsById.values()] };
}

function createDeleteCommands(
    state: MidiStoreState,
    operation: DeleteMidiGlobalTimeOperation,
    clipsById: ReadonlyMap<string, IndexedMidiClip>
): readonly MidiGlobalTimeCommand[] | null {
    const sourceIds = new Set<string>();
    const targetIds = new Set<string>();
    const commands: MidiGlobalTimeCommand[] = [];

    for (const split of operation.splits) {
        if (
            sourceIds.has(split.sourceClipId) ||
            targetIds.has(split.newClipId) ||
            split.sourceClipId === split.newClipId ||
            !isEligibleTarget(split.sourceClipId, clipsById) ||
            clipsById.has(split.newClipId) ||
            hasMidiData(state, split.newClipId)
        ) {
            return null;
        }

        sourceIds.add(split.sourceClipId);
        targetIds.add(split.newClipId);
        commands.push({
            type: 'split-notes',
            sourceClipId: split.sourceClipId,
            targetClipId: split.newClipId,
            splitBeat: split.splitBeat,
            ...(split.discardBeforeBeat === undefined ? {} : { discardBeforeBeat: split.discardBeforeBeat }),
        });
    }

    for (const sourceId of sourceIds) {
        if (targetIds.has(sourceId)) {
            return null;
        }
    }

    const removalIds = new Set<string>();
    for (const clipId of operation.removeClipIds) {
        const isPlannedTarget = targetIds.has(clipId);
        const isEligibleExistingClip = isEligibleTarget(clipId, clipsById);
        if (removalIds.has(clipId) || (!isPlannedTarget && !isEligibleExistingClip)) {
            return null;
        }
        removalIds.add(clipId);
        commands.push({ type: 'remove-clips', clipIds: [clipId] });
    }

    return commands;
}

function createDuplicateCommands(
    state: MidiStoreState,
    operation: DuplicateMidiGlobalTimeOperation,
    clipsById: ReadonlyMap<string, IndexedMidiClip>
): readonly MidiGlobalTimeCommand[] | null {
    const durationBeats = operation.endBeat - operation.startBeat;
    const commands: MidiGlobalTimeCommand[] = [createShiftCommand(clipsById, operation.endBeat, durationBeats)];
    const sourceIds = new Set<string>();
    const targetIds = new Set<string>();

    for (const copy of operation.copies) {
        if (
            sourceIds.has(copy.sourceClipId) ||
            targetIds.has(copy.newClipId) ||
            copy.sourceClipId === copy.newClipId ||
            !isEligibleTarget(copy.sourceClipId, clipsById) ||
            clipsById.has(copy.newClipId) ||
            hasMidiData(state, copy.newClipId)
        ) {
            return null;
        }

        sourceIds.add(copy.sourceClipId);
        targetIds.add(copy.newClipId);
        commands.push({ type: 'copy-notes', sourceClipId: copy.sourceClipId, targetClipId: copy.newClipId });
    }

    for (const sourceId of sourceIds) {
        if (targetIds.has(sourceId)) {
            return null;
        }
    }

    return commands;
}

function createCommands(
    state: MidiStoreState,
    input: ValidatedPreparationInput
): readonly MidiGlobalTimeCommand[] | null {
    if (input.operation.type === 'insert') {
        return [createShiftCommand(input.clipsById, input.operation.atBeat, input.operation.durationBeats)];
    }
    if (input.operation.type === 'delete') {
        return createDeleteCommands(state, input.operation, input.clipsById);
    }
    return createDuplicateCommands(state, input.operation, input.clipsById);
}

function replayNoteMatchesRequest(
    value: unknown,
    request: MidiGeneratedNoteIdentityRequest
): value is MidiGlobalTimeReplayNote {
    if (!isPlainObject(value) || !hasExactKeys(value, REPLAY_NOTE_KEYS)) {
        return false;
    }

    return (
        value.role === request.role &&
        value.sourceClipId === request.sourceClipId &&
        value.sourceNoteId === request.sourceNoteId &&
        value.sourceNoteIndex === request.sourceNoteIndex &&
        value.targetClipId === request.targetClipId &&
        isNonEmptyId(value.targetNoteId)
    );
}

function isValidReplayPlan(
    value: unknown,
    requests: readonly MidiGeneratedNoteIdentityRequest[]
): value is MidiGlobalTimeReplayPlan {
    if (!isPlainObject(value) || !hasExactKeys(value, REPLAY_PLAN_KEYS) || value.version !== 1) {
        return false;
    }
    if (!Array.isArray(value.notes) || value.notes.length !== requests.length) {
        return false;
    }

    for (const [index, request] of requests.entries()) {
        if (!replayNoteMatchesRequest(value.notes[index], request)) {
            return false;
        }
    }

    return true;
}

function allocateReplayPlan(requests: readonly MidiGeneratedNoteIdentityRequest[]): MidiGlobalTimeReplayPlan {
    const notes = requests.map((request) => ({
        ...request,
        targetNoteId: createMidiNote(0, 0, 0).id,
    }));
    return { version: 1, notes };
}

function rejectPreparation(): PreparedMidiGlobalTimeState {
    return { status: 'rejected', hasChanges: false, nextState: null, replayPlan: EMPTY_REPLAY_PLAN };
}

function prepareState(preparedState: MidiStoreState | null, input: unknown): PreparedMidiGlobalTimeState {
    if (!preparedState) {
        return rejectPreparation();
    }

    const validatedInput = validateInput(input);
    if (!validatedInput || !hasCompleteOwnership(preparedState, validatedInput.clipsById)) {
        return rejectPreparation();
    }

    const commands = createCommands(preparedState, validatedInput);
    if (!commands) {
        return rejectPreparation();
    }

    const planned = transformMidiGlobalTimeState({ state: preparedState, commands });
    if (planned.status === 'rejected') {
        return rejectPreparation();
    }

    let replayPlan: MidiGlobalTimeReplayPlan;
    if (validatedInput.suppliedReplayPlan === undefined) {
        replayPlan = allocateReplayPlan(planned.identityRequests);
    } else {
        if (!isValidReplayPlan(validatedInput.suppliedReplayPlan, planned.identityRequests)) {
            return rejectPreparation();
        }
        replayPlan = validatedInput.suppliedReplayPlan;
    }

    const targetNoteIds = replayPlan.notes.map((note) => note.targetNoteId);
    const transformed = transformMidiGlobalTimeState({ state: preparedState, commands, targetNoteIds });
    if (transformed.status === 'rejected') {
        return rejectPreparation();
    }

    return {
        status: 'ready',
        hasChanges: transformed.hasChanges,
        nextState: transformed.state,
        replayPlan,
    };
}

function isPublishingPhase(phase: TransactionPhase): boolean {
    return phase === 'publishing';
}

function createStateSnapshots(
    expectedState: MidiStoreState,
    replacementState: MidiStoreState
): MidiGlobalTimeStateSnapshots | null {
    const expected = midiTimeStateCodec.encodeState(expectedState);
    const replacement = midiTimeStateCodec.encodeState(replacementState);
    if (!expected || !replacement) {
        return null;
    }

    const nextValueSnapshot = midiTimeStateCodec.decodeState(expected);
    const preparedValueSnapshot = midiTimeStateCodec.decodeState(replacement);
    if (!nextValueSnapshot || !preparedValueSnapshot) {
        return null;
    }

    return {
        inversePlan: {
            version: 1,
            expected,
            replacement,
        },
        nextValueSnapshot,
        preparedValueSnapshot,
    };
}

function matchesReferenceAndValue(
    currentState: MidiStoreState | null,
    expectedReference: MidiStoreState,
    expectedValueSnapshot: MidiStoreState
): boolean {
    if (currentState !== expectedReference) {
        return false;
    }

    return midiTimeStateCodec.statesEqual(currentState, expectedValueSnapshot);
}

export function prepareMidiGlobalTimeTransaction(input: PrepareMidiGlobalTimeTransactionInput) {
    const preparedState = midiStore.value;
    let prepared = prepareState(preparedState, input);
    let stateSnapshots: MidiGlobalTimeStateSnapshots | null = null;
    if (prepared.status === 'ready' && prepared.hasChanges && preparedState && prepared.nextState) {
        stateSnapshots = createStateSnapshots(prepared.nextState, preparedState);
        if (!stateSnapshots) {
            prepared = rejectPreparation();
        }
    }
    let phase: TransactionPhase = prepared.hasChanges ? 'prepared' : 'closed';

    function apply(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'prepared') {
            phase = 'closed';
            return false;
        }
        if (!preparedState || !prepared.nextState || !stateSnapshots) {
            phase = 'closed';
            return false;
        }
        if (!matchesReferenceAndValue(midiStore.value, preparedState, stateSnapshots.preparedValueSnapshot)) {
            phase = 'closed';
            return false;
        }
        if (!midiTimeStateCodec.statesEqual(prepared.nextState, stateSnapshots.nextValueSnapshot)) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            midiStore.set(prepared.nextState);
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (!isPublishingPhase(phase)) {
            phase = 'closed';
            return false;
        }
        if (!matchesReferenceAndValue(midiStore.value, prepared.nextState, stateSnapshots.nextValueSnapshot)) {
            phase = 'closed';
            return false;
        }

        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'applied') {
            phase = 'closed';
            return false;
        }
        if (!preparedState || !prepared.nextState || !stateSnapshots) {
            phase = 'closed';
            return false;
        }
        if (!matchesReferenceAndValue(midiStore.value, prepared.nextState, stateSnapshots.nextValueSnapshot)) {
            phase = 'closed';
            return false;
        }
        if (!midiTimeStateCodec.statesEqual(preparedState, stateSnapshots.preparedValueSnapshot)) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            midiStore.set(preparedState);
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (!isPublishingPhase(phase)) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        return matchesReferenceAndValue(midiStore.value, preparedState, stateSnapshots.preparedValueSnapshot);
    }

    return {
        status: prepared.status,
        hasChanges: prepared.hasChanges,
        replayPlan: prepared.replayPlan,
        inversePlan: stateSnapshots?.inversePlan ?? null,
        apply,
        revert,
    };
}
