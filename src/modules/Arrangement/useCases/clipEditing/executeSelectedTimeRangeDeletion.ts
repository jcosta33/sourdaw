import { batchStoreUpdates } from '#/infra/store/createStore';

import { type Clip, type Track } from '../../models/Track';
import { getTrackState, type TrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { createClipSatelliteTransitionPlan } from '../../stores/clipSatelliteState';
import { createClipWriteTargetIndex } from '../../stores/resolveEligibleClipWriteTarget';
import { removeClipSatelliteData } from '../clip/removeClipSatelliteData';
import { prepareClipSatelliteStateRestore } from '../timeOperations/prepareClipSatelliteStateRestore';
import { timeOperationDependencies, type TimeOperationDependencies } from '../timeOperations/timeOperationDependencies';
import { timeOperationStateCodec } from '../timeOperations/timeOperationStateCodec';

type MidiPreparation = ReturnType<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']>;
type MidiReplayPlan = MidiPreparation['replayPlan'];
type AutomationPreparation = ReturnType<TimeOperationDependencies['prepareAutomationTimeOperation']>;
type ClipSatellitePreparation = ReturnType<typeof prepareClipSatelliteStateRestore>;

type SelectedTimeRangeOperation = {
    type: 'delete-selected-time-range';
    startBeat: number;
    endBeat: number;
    trackIds: readonly string[];
};

type ClipIdentityRequest = {
    role: 'selected-delete-right';
    sourceTrackId: string;
    sourceClipId: string;
};

type ClipReplayIdentity = ClipIdentityRequest & {
    targetClipId: string;
};

type SelectedTimeRangeDeletionReplayPlan = {
    version: 1;
    operation: SelectedTimeRangeOperation;
    clips: readonly ClipReplayIdentity[];
    midi: MidiReplayPlan;
};

type ExecuteSelectedTimeRangeDeletionInput = {
    startBeat: number;
    endBeat: number;
    trackIds: readonly string[];
    replayPlan?: SelectedTimeRangeDeletionReplayPlan;
};

type PreparedHandle = {
    name: string;
    hasChanges: boolean;
    apply: () => boolean;
    revert: () => boolean;
    restoreApplied: () => boolean;
};

type AppliedSelectedTimeRangeDeletion = {
    status: 'applied';
    hasChanges: true;
    replayPlan: SelectedTimeRangeDeletionReplayPlan;
    inversePlan: Record<string, unknown>;
    undo: () => boolean;
};

type NoChangeSelectedTimeRangeDeletion = {
    status: 'no-change';
    hasChanges: false;
    replayPlan: SelectedTimeRangeDeletionReplayPlan;
    inversePlan: null;
};

type RejectedSelectedTimeRangeDeletion = {
    status: 'rejected';
    hasChanges: false;
    replayPlan: null;
    inversePlan: null;
};

type SelectedTimeRangeDeletionResult =
    AppliedSelectedTimeRangeDeletion | NoChangeSelectedTimeRangeDeletion | RejectedSelectedTimeRangeDeletion;

type ValidatedInput = {
    operation: SelectedTimeRangeOperation;
    suppliedReplayPlan: unknown;
};

type NormalizedStore = Extract<ReturnType<typeof createClipWriteTargetIndex>, { status: 'valid' }>;
type NormalizedOwner = NormalizedStore['tracks'][number];

type PlannedLocalState = {
    trackState: TrackState;
    midiOperation: {
        type: 'delete';
        startBeat: number;
        endBeat: number;
        splits: readonly {
            sourceClipId: string;
            newClipId: string;
            splitBeat: number;
            discardBeforeBeat?: number;
        }[];
        removeClipIds: readonly string[];
    };
};

type LocalTransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

const INPUT_KEYS = ['startBeat', 'endBeat', 'trackIds'] as const;
const INPUT_WITH_REPLAY_KEYS = ['startBeat', 'endBeat', 'trackIds', 'replayPlan'] as const;
const OPERATION_KEYS = ['type', 'startBeat', 'endBeat', 'trackIds'] as const;
const REPLAY_KEYS = ['version', 'operation', 'clips', 'midi'] as const;
const CLIP_REPLAY_KEYS = ['role', 'sourceTrackId', 'sourceClipId', 'targetClipId'] as const;
const MIDI_REPLAY_KEYS = ['version', 'notes'] as const;

class UnrecoveredSelectedTimeRangeDeletionError extends Error {
    readonly originalFailure: unknown;
    readonly compensationFailures: readonly unknown[];

    constructor(originalFailure: unknown, compensationFailures: readonly unknown[]) {
        super('Selected time range deletion left unrecovered partial state', {
            cause: new AggregateError(
                [originalFailure, ...compensationFailures],
                'Selected time range publication and compensation both failed'
            ),
        });
        this.name = 'UnrecoveredSelectedTimeRangeDeletionError';
        this.originalFailure = originalFailure;
        this.compensationFailures = compensationFailures;
    }
}

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

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function hasExactOptionalReplayKey(value: Record<string, unknown>): boolean {
    if (Object.hasOwn(value, 'replayPlan')) {
        return hasExactKeys(value, INPUT_WITH_REPLAY_KEYS);
    }
    return hasExactKeys(value, INPUT_KEYS);
}

function isNonEmptyId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNonNegative(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function validateTrackIds(value: unknown): readonly string[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const seen = new Set<string>();
    const trackIds: string[] = [];
    for (const trackId of value) {
        if (!isNonEmptyId(trackId) || seen.has(trackId)) {
            return null;
        }
        seen.add(trackId);
        trackIds.push(trackId);
    }
    return trackIds;
}

function validateInput(input: unknown): ValidatedInput | null {
    if (!isPlainObject(input) || !hasExactOptionalReplayKey(input)) {
        return null;
    }
    if (!isFiniteNonNegative(input.startBeat)) {
        return null;
    }
    if (!isFiniteNumber(input.endBeat) || input.endBeat <= input.startBeat) {
        return null;
    }
    const trackIds = validateTrackIds(input.trackIds);
    if (!trackIds) {
        return null;
    }

    return {
        operation: {
            type: 'delete-selected-time-range',
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            trackIds,
        },
        suppliedReplayPlan: input.replayPlan,
    };
}

function isNullableString(value: unknown): boolean {
    return value === null || typeof value === 'string';
}

function validateTrack(track: unknown): boolean {
    if (!isPlainObject(track)) {
        return false;
    }
    if (!isNonEmptyId(track.id) || typeof track.name !== 'string' || !Array.isArray(track.clips)) {
        return false;
    }
    if (
        track.kind !== 'audio' &&
        track.kind !== 'midi' &&
        track.kind !== 'bus' &&
        track.kind !== 'master' &&
        track.kind !== 'folder' &&
        track.kind !== 'vca'
    ) {
        return false;
    }
    if (
        typeof track.muted !== 'boolean' ||
        typeof track.soloed !== 'boolean' ||
        typeof track.armed !== 'boolean' ||
        typeof track.frozen !== 'boolean' ||
        typeof track.collapsed !== 'boolean' ||
        typeof track.hidden !== 'boolean' ||
        typeof track.disabled !== 'boolean' ||
        typeof track.soloSafe !== 'boolean' ||
        typeof track.followChordTrack !== 'boolean'
    ) {
        return false;
    }
    if (!isFiniteNumber(track.gain) || !isFiniteNumber(track.pan) || !isFiniteNumber(track.height)) {
        return false;
    }
    if (
        typeof track.color !== 'string' ||
        typeof track.outputId !== 'string' ||
        typeof track.notes !== 'string' ||
        typeof track.activeAlternativeId !== 'string'
    ) {
        return false;
    }
    if (
        !Array.isArray(track.devices) ||
        !Array.isArray(track.sends) ||
        !Array.isArray(track.midiFx) ||
        !Array.isArray(track.alternatives)
    ) {
        return false;
    }
    if (
        !isNullableString(track.parentId) ||
        !isNullableString(track.groupId) ||
        !isNullableString(track.inputId) ||
        !isNullableString(track.vcaGroupId) ||
        !isNullableString(track.midiOutputTrackId)
    ) {
        return false;
    }
    if (track.inputMonitoring !== 'auto' && track.inputMonitoring !== 'on' && track.inputMonitoring !== 'off') {
        return false;
    }
    if (
        track.automationMode !== 'read' &&
        track.automationMode !== 'write' &&
        track.automationMode !== 'touch' &&
        track.automationMode !== 'latch' &&
        track.automationMode !== 'off'
    ) {
        return false;
    }
    return isPlainObject(track.freezeState);
}

function validateClip(clip: unknown): boolean {
    if (!isPlainObject(clip)) {
        return false;
    }
    if (!isNonEmptyId(clip.id) || !isNonEmptyId(clip.trackId) || typeof clip.name !== 'string') {
        return false;
    }
    if (!isFiniteNonNegative(clip.startBeat) || !isFiniteNonNegative(clip.endBeat)) {
        return false;
    }
    if (clip.endBeat <= clip.startBeat || (clip.type !== 'audio' && clip.type !== 'midi')) {
        return false;
    }
    if (
        !isFiniteNumber(clip.fadeInBeats) ||
        !isFiniteNumber(clip.fadeOutBeats) ||
        !isFiniteNumber(clip.gain) ||
        typeof clip.color !== 'string' ||
        typeof clip.locked !== 'boolean' ||
        typeof clip.muted !== 'boolean'
    ) {
        return false;
    }
    if (clip.audioOffsetBeats !== undefined && !isFiniteNumber(clip.audioOffsetBeats)) {
        return false;
    }
    if (clip.midiOffsetBeats !== undefined && !isFiniteNumber(clip.midiOffsetBeats)) {
        return false;
    }
    return true;
}

function validateStore(state: TrackState): NormalizedStore | null {
    const normalized = createClipWriteTargetIndex(state);
    if (normalized.status !== 'valid') {
        return null;
    }
    for (const owner of normalized.tracks) {
        if (!validateTrack(owner.source)) {
            return null;
        }
        for (const clip of owner.clips) {
            if (!validateClip(clip.source)) {
                return null;
            }
        }
    }
    return normalized;
}

function resolveRequestedOwners(
    normalized: NormalizedStore,
    trackIds: readonly string[]
): readonly NormalizedOwner[] | null {
    const owners: NormalizedOwner[] = [];
    for (const trackId of trackIds) {
        const owner = normalized.tracksById.get(trackId);
        if (!owner || !owner.acceptsClipUpdate) {
            return null;
        }
        owners.push(owner);
    }
    return owners;
}

function isValidComputedOffset(value: number): boolean {
    return Number.isFinite(value);
}

function isValidComputedBeat(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function validateComputedValues(owners: readonly NormalizedOwner[], operation: SelectedTimeRangeOperation): boolean {
    for (const owner of owners) {
        for (const normalizedClip of owner.clips) {
            const clip = normalizedClip.source;
            const spansRange = clip.startBeat < operation.startBeat && clip.endBeat > operation.endBeat;
            const overlapsRightEdge = clip.startBeat < operation.endBeat && clip.endBeat > operation.endBeat;
            if (spansRange || overlapsRightEdge) {
                const nextAudioOffset = (clip.audioOffsetBeats ?? 0) + (operation.endBeat - clip.startBeat);
                if (!isValidComputedOffset(nextAudioOffset)) {
                    return false;
                }
            }
            if (spansRange && clip.type === 'midi') {
                const midiOffset = clip.midiOffsetBeats ?? 0;
                const splitBeat = operation.endBeat - clip.startBeat + midiOffset;
                const discardBeforeBeat = operation.startBeat - clip.startBeat + midiOffset;
                if (!isValidComputedBeat(splitBeat) || !isValidComputedBeat(discardBeforeBeat)) {
                    return false;
                }
                if (discardBeforeBeat > splitBeat) {
                    return false;
                }
            }
        }
    }
    return true;
}

function createClipIdentityRequests(
    normalized: NormalizedStore,
    operation: SelectedTimeRangeOperation
): readonly ClipIdentityRequest[] {
    const selectedTrackIds = new Set(operation.trackIds);
    const requests: ClipIdentityRequest[] = [];
    for (const owner of normalized.tracks) {
        if (!selectedTrackIds.has(owner.id)) {
            continue;
        }
        for (const normalizedClip of owner.clips) {
            const clip = normalizedClip.source;
            if (clip.startBeat < operation.startBeat && clip.endBeat > operation.endBeat) {
                requests.push({
                    role: 'selected-delete-right',
                    sourceTrackId: owner.id,
                    sourceClipId: clip.id,
                });
            }
        }
    }
    return requests;
}

function collectExistingClipIds(normalized: NormalizedStore): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const owner of normalized.tracks) {
        for (const clip of owner.clips) {
            ids.add(clip.id);
        }
    }
    return ids;
}

function allocateClipIdentities(
    requests: readonly ClipIdentityRequest[],
    existingClipIds: ReadonlySet<string>
): readonly ClipReplayIdentity[] | null {
    const targetIds = new Set<string>();
    const identities: ClipReplayIdentity[] = [];
    for (const request of requests) {
        let generatedUuid: string;
        try {
            generatedUuid = crypto.randomUUID();
        } catch {
            return null;
        }
        const fragment = generatedUuid.slice(0, 8);
        if (fragment.length === 0) {
            return null;
        }
        const targetClipId = `clip-dtr-${fragment}`;
        if (!isNonEmptyId(targetClipId) || existingClipIds.has(targetClipId) || targetIds.has(targetClipId)) {
            return null;
        }
        targetIds.add(targetClipId);
        identities.push({ ...request, targetClipId });
    }
    return identities;
}

function operationsMatch(left: unknown, right: SelectedTimeRangeOperation): boolean {
    if (!isPlainObject(left) || !hasExactKeys(left, OPERATION_KEYS)) {
        return false;
    }
    if (left.type !== right.type || left.startBeat !== right.startBeat || left.endBeat !== right.endBeat) {
        return false;
    }
    if (!Array.isArray(left.trackIds) || left.trackIds.length !== right.trackIds.length) {
        return false;
    }
    for (const [index, trackId] of right.trackIds.entries()) {
        if (left.trackIds[index] !== trackId) {
            return false;
        }
    }
    return true;
}

function validateSuppliedReplayPlan(
    value: unknown,
    operation: SelectedTimeRangeOperation,
    requests: readonly ClipIdentityRequest[],
    existingClipIds: ReadonlySet<string>
): value is SelectedTimeRangeDeletionReplayPlan {
    if (!isPlainObject(value) || !hasExactKeys(value, REPLAY_KEYS) || value.version !== 1) {
        return false;
    }
    if (!operationsMatch(value.operation, operation) || !isUnknownArray(value.clips)) {
        return false;
    }
    if (value.clips.length !== requests.length || !isPlainObject(value.midi)) {
        return false;
    }

    const targetIds = new Set<string>();
    for (const [index, request] of requests.entries()) {
        const identity = value.clips[index];
        if (!isPlainObject(identity) || !hasExactKeys(identity, CLIP_REPLAY_KEYS)) {
            return false;
        }
        if (
            identity.role !== request.role ||
            identity.sourceTrackId !== request.sourceTrackId ||
            identity.sourceClipId !== request.sourceClipId ||
            !isNonEmptyId(identity.targetClipId)
        ) {
            return false;
        }
        if (existingClipIds.has(identity.targetClipId) || targetIds.has(identity.targetClipId)) {
            return false;
        }
        targetIds.add(identity.targetClipId);
    }
    return true;
}

function isEmptyMidiReplayPlan(value: unknown): value is MidiReplayPlan {
    if (!isPlainObject(value) || !hasExactKeys(value, MIDI_REPLAY_KEYS) || value.version !== 1) {
        return false;
    }
    return Array.isArray(value.notes) && value.notes.length === 0;
}

function createEmptyReplayPlan(
    operation: SelectedTimeRangeOperation,
    suppliedReplayPlan: unknown
): SelectedTimeRangeDeletionReplayPlan | null {
    if (suppliedReplayPlan === undefined) {
        return {
            version: 1,
            operation,
            clips: [],
            midi: { version: 1, notes: [] },
        };
    }
    if (
        !validateSuppliedReplayPlan(suppliedReplayPlan, operation, [], new Set<string>()) ||
        !isEmptyMidiReplayPlan(suppliedReplayPlan.midi)
    ) {
        return null;
    }
    return suppliedReplayPlan;
}

function createMidiOwners(normalized: NormalizedStore) {
    return normalized.tracks.map((owner) => {
        const clips = owner.clips.map((normalizedClip) => {
            const clip = normalizedClip.source;
            const snapshot: {
                clipId: string;
                startBeat: number;
                endBeat: number;
                midiOffsetBeats?: number;
            } = {
                clipId: clip.id,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
            };
            if (clip.midiOffsetBeats !== undefined) {
                snapshot.midiOffsetBeats = clip.midiOffsetBeats;
            }
            return snapshot;
        });
        return {
            trackId: owner.id,
            eligible: owner.acceptsClipUpdate,
            clips,
        };
    });
}

function getClipIdentity(
    identities: readonly ClipReplayIdentity[],
    identityIndex: number,
    owner: NormalizedOwner,
    clip: Clip
): ClipReplayIdentity | null {
    const identity = identities[identityIndex];
    if (!identity) {
        return null;
    }
    if (identity.sourceTrackId !== owner.id || identity.sourceClipId !== clip.id) {
        return null;
    }
    return identity;
}

function planTrack(
    owner: NormalizedOwner,
    operation: SelectedTimeRangeOperation,
    identities: readonly ClipReplayIdentity[],
    initialIdentityIndex: number,
    splits: Array<{
        sourceClipId: string;
        newClipId: string;
        splitBeat: number;
        discardBeforeBeat?: number;
    }>,
    removeClipIds: string[]
): { track: Track; identityIndex: number } | null {
    const finalClips: Clip[] = [];
    let changed = false;
    let identityIndex = initialIdentityIndex;

    for (const normalizedClip of owner.clips) {
        const clip = normalizedClip.source;
        if (clip.startBeat >= operation.startBeat && clip.endBeat <= operation.endBeat) {
            removeClipIds.push(clip.id);
            changed = true;
            continue;
        }
        if (clip.startBeat < operation.startBeat && clip.endBeat > operation.endBeat) {
            const identity = getClipIdentity(identities, identityIndex, owner, clip);
            if (!identity) {
                return null;
            }
            identityIndex++;
            const leftClip: Clip = {
                ...clip,
                endBeat: operation.startBeat,
                name: `${clip.name} (L)`,
            };
            const rightClip: Clip = {
                ...clip,
                id: identity.targetClipId,
                startBeat: operation.endBeat,
                name: `${clip.name} (R)`,
                audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (operation.endBeat - clip.startBeat),
                midiOffsetBeats: 0,
            };
            finalClips.push(leftClip, rightClip);
            if (clip.type === 'midi') {
                splits.push({
                    sourceClipId: clip.id,
                    newClipId: identity.targetClipId,
                    splitBeat: operation.endBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0),
                    discardBeforeBeat: operation.startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0),
                });
            }
            changed = true;
            continue;
        }
        if (clip.startBeat < operation.startBeat && clip.endBeat > operation.startBeat) {
            finalClips.push({ ...clip, endBeat: operation.startBeat });
            changed = true;
            continue;
        }
        if (clip.startBeat < operation.endBeat && clip.endBeat > operation.endBeat) {
            finalClips.push({
                ...clip,
                startBeat: operation.endBeat,
                audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (operation.endBeat - clip.startBeat),
            });
            changed = true;
            continue;
        }
        finalClips.push(clip);
    }

    if (!changed) {
        return { track: owner.source, identityIndex };
    }
    return {
        track: {
            ...owner.source,
            clips: finalClips,
        },
        identityIndex,
    };
}

function prepareLocalState(
    state: TrackState,
    normalized: NormalizedStore,
    requestedOwners: readonly NormalizedOwner[],
    operation: SelectedTimeRangeOperation,
    identities: readonly ClipReplayIdentity[]
): PlannedLocalState | null {
    const selectedIds = new Set(operation.trackIds);
    const requestedOwnersById = new Map<string, NormalizedOwner>();
    for (const owner of requestedOwners) {
        requestedOwnersById.set(owner.id, owner);
    }

    const tracks: Track[] = [];
    const splits: Array<{
        sourceClipId: string;
        newClipId: string;
        splitBeat: number;
        discardBeforeBeat?: number;
    }> = [];
    const removeClipIds: string[] = [];
    let identityIndex = 0;
    let hasTrackChanges = false;

    for (const normalizedOwner of normalized.tracks) {
        if (!selectedIds.has(normalizedOwner.id)) {
            tracks.push(normalizedOwner.source);
            continue;
        }
        const owner = requestedOwnersById.get(normalizedOwner.id);
        if (!owner) {
            return null;
        }
        const planned = planTrack(owner, operation, identities, identityIndex, splits, removeClipIds);
        if (!planned) {
            return null;
        }
        identityIndex = planned.identityIndex;
        tracks.push(planned.track);
        if (planned.track !== normalizedOwner.source) {
            hasTrackChanges = true;
        }
    }
    if (identityIndex !== identities.length) {
        return null;
    }

    let trackState = state;
    if (hasTrackChanges) {
        trackState = { ...state, tracks };
    }
    return {
        trackState,
        midiOperation: {
            type: 'delete',
            startBeat: operation.startBeat,
            endBeat: operation.endBeat,
            splits,
            removeClipIds,
        },
    };
}

function createLocalHandle(input: { capturedState: TrackState; nextState: TrackState }): PreparedHandle {
    const hasChanges = input.capturedState !== input.nextState;
    let phase: LocalTransactionPhase = 'closed';
    if (hasChanges) {
        phase = 'prepared';
    }

    function read(): TrackState | null {
        return getTrackState();
    }

    function write(state: TrackState): void {
        setTrackState(state);
    }

    function compensateExact(expectedState: TrackState, restoredState: TrackState): unknown[] {
        const failures: unknown[] = [];
        if (read() !== expectedState) {
            failures.push(new Error('Arrangement compensation found an unexpected reference'));
            return failures;
        }
        try {
            write(restoredState);
        } catch (error) {
            failures.push(error);
            return failures;
        }
        if (read() !== restoredState) {
            failures.push(new Error('Arrangement compensation did not restore the exact reference'));
        }
        return failures;
    }

    function apply(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'prepared') {
            phase = 'closed';
            return false;
        }
        if (read() !== input.capturedState) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            write(input.nextState);
        } catch (error) {
            const publishedState = read();
            if (publishedState === input.nextState) {
                const compensationFailures = compensateExact(input.nextState, input.capturedState);
                phase = 'closed';
                if (compensationFailures.length > 0) {
                    throw new UnrecoveredSelectedTimeRangeDeletionError(error, compensationFailures);
                }
                throw error;
            }
            phase = 'closed';
            if (publishedState !== input.capturedState) {
                throw new UnrecoveredSelectedTimeRangeDeletionError(error, [
                    new Error('Arrangement cannot safely compensate an unexpected published reference'),
                ]);
            }
            throw error;
        }

        const publishedState = read();
        if (publishedState !== input.nextState) {
            if (publishedState === input.capturedState) {
                phase = 'closed';
                return false;
            }
            phase = 'closed';
            throw new UnrecoveredSelectedTimeRangeDeletionError(
                new Error('Arrangement did not publish the prepared state'),
                [new Error('Arrangement cannot safely compensate an unexpected published reference')]
            );
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
        if (read() !== input.nextState) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            write(input.capturedState);
        } catch (error) {
            const restoredState = read();
            if (restoredState === input.capturedState) {
                const compensationFailures = compensateExact(input.capturedState, input.nextState);
                if (compensationFailures.length > 0) {
                    phase = 'closed';
                    throw new UnrecoveredSelectedTimeRangeDeletionError(error, compensationFailures);
                }
                phase = 'applied';
                throw error;
            }
            if (restoredState === input.nextState) {
                phase = 'applied';
                throw error;
            }
            phase = 'closed';
            throw new UnrecoveredSelectedTimeRangeDeletionError(error, [
                new Error('Arrangement undo found an unexpected published reference'),
            ]);
        }
        const restoredState = read();
        if (restoredState === input.capturedState) {
            phase = 'closed';
            return true;
        }
        if (restoredState === input.nextState) {
            phase = 'applied';
            return false;
        }
        phase = 'closed';
        throw new UnrecoveredSelectedTimeRangeDeletionError(
            new Error('Arrangement undo did not restore the captured reference'),
            [new Error('Arrangement undo cannot safely compensate an unexpected reference')]
        );
    }

    function restoreApplied(): boolean {
        if (read() !== input.capturedState) {
            return false;
        }
        try {
            write(input.nextState);
        } catch (error) {
            if (read() === input.nextState) {
                phase = 'applied';
            }
            throw error;
        }
        if (read() !== input.nextState) {
            return false;
        }
        phase = 'applied';
        return true;
    }

    return {
        name: 'Arrangement',
        hasChanges,
        apply,
        revert,
        restoreApplied,
    };
}

function asMidiHandle(preparation: MidiPreparation): PreparedHandle {
    return {
        name: 'MIDI',
        hasChanges: preparation.hasChanges,
        apply: preparation.apply,
        revert: preparation.revert,
        restoreApplied: () => false,
    };
}

function asOwnerHandle(name: string, preparation: AutomationPreparation | ClipSatellitePreparation): PreparedHandle {
    return {
        name,
        hasChanges: preparation.hasChanges,
        apply: preparation.apply,
        revert: preparation.revert,
        restoreApplied: () => false,
    };
}

/**
 * Automation's view of the tracks this deletion touches.
 *
 * Every track is listed — a lane whose track is missing makes the preparation
 * reject — but none is `eligible`, because deleting a selected time range does
 * not ripple automation points today. The call is here for the one thing it
 * still has to do inside this transaction: retire the clip-scoped lanes of the
 * clips the deletion removes. Leaving such a lane behind pins it to a clip id
 * nothing owns, and every later time operation rejects on it.
 */
function createAutomationOwners(normalized: NormalizedStore) {
    return normalized.tracks.map((owner) => ({
        trackId: owner.id,
        eligible: false,
        clipIds: owner.clips.map((clip) => clip.id),
    }));
}

function cloneOwnerInversePlan(preparation: {
    hasChanges: boolean;
    inversePlan: Record<string, unknown> | null;
}): Record<string, unknown> | null | false {
    if (!preparation.hasChanges) {
        return preparation.inversePlan === null ? null : false;
    }
    if (preparation.inversePlan === null) {
        return false;
    }
    const cloned = timeOperationStateCodec.cloneJsonPlan(preparation.inversePlan);
    if (cloned) {
        return cloned;
    }
    return timeOperationStateCodec.encodeOpaqueJsonPlan(preparation.inversePlan) ?? false;
}

function compensateAppliedHandles(applied: readonly PreparedHandle[]): unknown[] {
    const failures: unknown[] = [];
    for (let index = applied.length - 1; index >= 0; index--) {
        const handle = applied[index];
        if (!handle) {
            continue;
        }
        try {
            if (!handle.revert()) {
                failures.push(new Error(`${handle.name} compensation returned false`));
            }
        } catch (error) {
            if (error instanceof UnrecoveredSelectedTimeRangeDeletionError) {
                failures.push(error.originalFailure, ...error.compensationFailures);
            } else {
                failures.push(error);
            }
        }
    }
    return failures;
}

function publishHandles(handles: readonly PreparedHandle[], removedClipIds: readonly string[]): boolean {
    return batchStoreUpdates(() => {
        const applied: PreparedHandle[] = [];
        for (const handle of handles) {
            let appliedSuccessfully: boolean;
            try {
                appliedSuccessfully = handle.apply();
            } catch (error) {
                const crossHandleFailures = compensateAppliedHandles(applied);
                if (error instanceof UnrecoveredSelectedTimeRangeDeletionError) {
                    if (crossHandleFailures.length === 0) {
                        throw error;
                    }
                    throw new UnrecoveredSelectedTimeRangeDeletionError(error.originalFailure, [
                        ...error.compensationFailures,
                        ...crossHandleFailures,
                    ]);
                }
                if (crossHandleFailures.length > 0) {
                    throw new UnrecoveredSelectedTimeRangeDeletionError(error, crossHandleFailures);
                }
                throw error;
            }
            if (!appliedSuccessfully) {
                const failure = new Error(`${handle.name} publication returned false`);
                const compensationFailures = compensateAppliedHandles(applied);
                if (compensationFailures.length > 0) {
                    throw new UnrecoveredSelectedTimeRangeDeletionError(failure, compensationFailures);
                }
                return false;
            }
            applied.push(handle);
        }

        // Undoable satellites (clip-scoped automation lanes, gain envelopes,
        // warp states) were retired by the handles above; this sweep clears the
        // rest of the per-clip records — clipboard entries and the ephemeral
        // drag-preview and active-recording refs, none of which participate in
        // undo. Every removal is a no-op for an id already dropped.
        removeClipSatelliteData(removedClipIds);
        return true;
    });
}

function compensateRestoredHandles(restored: readonly PreparedHandle[]): unknown[] {
    const failures: unknown[] = [];
    for (let index = restored.length - 1; index >= 0; index--) {
        const handle = restored[index];
        if (!handle) {
            continue;
        }
        try {
            if (!handle.restoreApplied()) {
                failures.push(new Error(`${handle.name} undo compensation returned false`));
            }
        } catch (error) {
            failures.push(error);
        }
    }
    return failures;
}

function undoAppliedHandles(handles: readonly PreparedHandle[]): boolean {
    return batchStoreUpdates(() => {
        const restored: PreparedHandle[] = [];
        for (let index = handles.length - 1; index >= 0; index--) {
            const handle = handles[index];
            if (!handle) {
                continue;
            }
            let restoredSuccessfully: boolean;
            try {
                restoredSuccessfully = handle.revert();
            } catch (error) {
                const crossHandleFailures = compensateRestoredHandles(restored);
                if (error instanceof UnrecoveredSelectedTimeRangeDeletionError) {
                    if (crossHandleFailures.length === 0) {
                        throw error;
                    }
                    throw new UnrecoveredSelectedTimeRangeDeletionError(error.originalFailure, [
                        ...error.compensationFailures,
                        ...crossHandleFailures,
                    ]);
                }
                if (crossHandleFailures.length > 0) {
                    throw new UnrecoveredSelectedTimeRangeDeletionError(error, crossHandleFailures);
                }
                throw error;
            }
            if (!restoredSuccessfully) {
                const failure = new Error(`${handle.name} undo returned false`);
                const compensationFailures = compensateRestoredHandles(restored);
                if (compensationFailures.length > 0) {
                    throw new UnrecoveredSelectedTimeRangeDeletionError(failure, compensationFailures);
                }
                throw failure;
            }
            restored.push(handle);
        }
        return true;
    });
}

function createCombinedInversePlan(input: {
    expectedTrackState: TrackState;
    replacementTrackState: TrackState;
    midiPreparation: MidiPreparation;
    automationPreparation: AutomationPreparation;
    clipSatellitePreparation: { hasChanges: boolean; inversePlan: Record<string, unknown> | null };
}): Record<string, unknown> | null {
    const expectedTrackState = timeOperationStateCodec.encodeTrackState(input.expectedTrackState);
    const replacementTrackState = timeOperationStateCodec.encodeTrackState(input.replacementTrackState);
    if (!expectedTrackState || !replacementTrackState) {
        return null;
    }

    const midi = cloneOwnerInversePlan(input.midiPreparation);
    const automation = cloneOwnerInversePlan(input.automationPreparation);
    const clipSatellites = cloneOwnerInversePlan(input.clipSatellitePreparation);
    if (midi === false || automation === false || clipSatellites === false) {
        return null;
    }

    return {
        version: 1,
        scope: 'selected-range',
        local: {
            version: 1,
            expected: {
                trackState: expectedTrackState,
                markerState: null,
            },
            replacement: {
                trackState: replacementTrackState,
                markerState: null,
            },
        },
        automation,
        midi,
        timelineMap: null,
        clipSatellites,
    };
}

function rejectResult(): RejectedSelectedTimeRangeDeletion {
    return {
        status: 'rejected',
        hasChanges: false,
        replayPlan: null,
        inversePlan: null,
    };
}

export function executeSelectedTimeRangeDeletion(
    input: ExecuteSelectedTimeRangeDeletionInput
): SelectedTimeRangeDeletionResult {
    const validated = validateInput(input);
    if (!validated) {
        return rejectResult();
    }

    if (validated.operation.trackIds.length === 0) {
        const replayPlan = createEmptyReplayPlan(validated.operation, validated.suppliedReplayPlan);
        if (!replayPlan) {
            return rejectResult();
        }
        return {
            status: 'no-change',
            hasChanges: false,
            replayPlan,
            inversePlan: null,
        };
    }

    const trackState = getTrackState();
    if (!trackState) {
        return rejectResult();
    }
    const normalized = validateStore(trackState);
    if (!normalized) {
        return rejectResult();
    }
    const requestedOwners = resolveRequestedOwners(normalized, validated.operation.trackIds);
    if (!requestedOwners || !validateComputedValues(requestedOwners, validated.operation)) {
        return rejectResult();
    }

    const deps = timeOperationDependencies;
    if (!deps) {
        throw new Error('Arrangement time operation dependencies are not registered');
    }

    const requests = createClipIdentityRequests(normalized, validated.operation);
    const existingClipIds = collectExistingClipIds(normalized);
    let identities: readonly ClipReplayIdentity[];
    let suppliedReplayPlan: SelectedTimeRangeDeletionReplayPlan | null = null;
    if (validated.suppliedReplayPlan === undefined) {
        const allocated = allocateClipIdentities(requests, existingClipIds);
        if (!allocated) {
            return rejectResult();
        }
        identities = allocated;
    } else {
        if (!validateSuppliedReplayPlan(validated.suppliedReplayPlan, validated.operation, requests, existingClipIds)) {
            return rejectResult();
        }
        suppliedReplayPlan = validated.suppliedReplayPlan;
        identities = suppliedReplayPlan.clips;
    }

    const local = prepareLocalState(trackState, normalized, requestedOwners, validated.operation, identities);
    if (!local) {
        return rejectResult();
    }

    let midiPreparationInput: Parameters<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']>[0] = {
        operation: local.midiOperation,
        owners: createMidiOwners(normalized),
    };
    if (suppliedReplayPlan) {
        midiPreparationInput = {
            ...midiPreparationInput,
            replayPlan: suppliedReplayPlan.midi,
        };
    }
    const midiPreparation = deps.prepareMidiGlobalTimeTransaction(midiPreparationInput);
    if (midiPreparation.status !== 'ready') {
        return rejectResult();
    }

    // The clips this deletion removes take their satellites with them, inside
    // the same transaction, so undo restores every one of them.
    const removedClipIds = local.midiOperation.removeClipIds;
    const automationPreparation = deps.prepareAutomationTimeOperation({
        operation: { type: 'delete', startBeat: validated.operation.startBeat, endBeat: validated.operation.endBeat },
        owners: createAutomationOwners(normalized),
        removedClipIds,
    });
    if (automationPreparation.status !== 'ready') {
        return rejectResult();
    }
    const clipSatellitePlan = createClipSatelliteTransitionPlan({ removedClipIds, migrations: [] });
    if (!clipSatellitePlan) {
        return rejectResult();
    }
    const clipSatellitePreparation = prepareClipSatelliteStateRestore(clipSatellitePlan);
    if (clipSatellitePreparation.status !== 'ready') {
        return rejectResult();
    }

    let replayPlan: SelectedTimeRangeDeletionReplayPlan;
    if (suppliedReplayPlan) {
        if (midiPreparation.replayPlan !== suppliedReplayPlan.midi) {
            return rejectResult();
        }
        replayPlan = suppliedReplayPlan;
    } else {
        replayPlan = {
            version: 1,
            operation: validated.operation,
            clips: identities,
            midi: midiPreparation.replayPlan,
        };
    }

    const localHandle = createLocalHandle({
        capturedState: trackState,
        nextState: local.trackState,
    });
    const midiHandle = asMidiHandle(midiPreparation);
    const automationHandle = asOwnerHandle('Automation', automationPreparation);
    const clipSatelliteHandle = asOwnerHandle('Clip satellites', clipSatellitePreparation);
    const handles: PreparedHandle[] = [];
    if (midiHandle.hasChanges) {
        handles.push(midiHandle);
    }
    if (automationHandle.hasChanges) {
        handles.push(automationHandle);
    }
    if (clipSatelliteHandle.hasChanges) {
        handles.push(clipSatelliteHandle);
    }
    if (localHandle.hasChanges) {
        handles.push(localHandle);
    }
    if (handles.length === 0) {
        return {
            status: 'no-change',
            hasChanges: false,
            replayPlan,
            inversePlan: null,
        };
    }

    const inversePlan = createCombinedInversePlan({
        expectedTrackState: local.trackState,
        replacementTrackState: trackState,
        midiPreparation,
        automationPreparation,
        clipSatellitePreparation: {
            hasChanges: clipSatellitePreparation.hasChanges,
            inversePlan: clipSatellitePreparation.hasChanges
                ? {
                      version: 1,
                      expected: clipSatellitePlan.replacement,
                      replacement: clipSatellitePlan.expected,
                  }
                : null,
        },
    });
    if (!inversePlan) {
        return rejectResult();
    }

    const applied = publishHandles(handles, removedClipIds);
    if (!applied) {
        return rejectResult();
    }
    return {
        status: 'applied',
        hasChanges: true,
        replayPlan,
        inversePlan,
        undo: () => undoAppliedHandles(handles),
    };
}
