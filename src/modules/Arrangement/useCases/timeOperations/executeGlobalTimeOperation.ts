import { batchStoreUpdates } from '#/infra/store/createStore';

import { type Clip, type Track } from '../../models/Track';
import { getTrackState, type TrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { createClipSatelliteRemovalPlan } from '../../stores/clipSatelliteState';
import { markerStore, type MarkerStoreState } from '../../stores/markerStore';
import { createClipWriteTargetIndex } from '../../stores/resolveEligibleClipWriteTarget';
import { removeClipSatelliteData } from '../clip/removeClipSatelliteData';

import { prepareClipSatelliteStateRestore } from './prepareClipSatelliteStateRestore';
import { timeOperationDependencies, type TimeOperationDependencies } from './timeOperationDependencies';
import { timeOperationStateCodec } from './timeOperationStateCodec';

type InsertGlobalTimeOperation = {
    type: 'insert';
    atBeat: number;
    durationBeats: number;
};

type DeleteGlobalTimeOperation = {
    type: 'delete';
    startBeat: number;
    endBeat: number;
};

type DuplicateGlobalTimeOperation = {
    type: 'duplicate';
    startBeat: number;
    endBeat: number;
};

type GlobalTimeOperation = InsertGlobalTimeOperation | DeleteGlobalTimeOperation | DuplicateGlobalTimeOperation;

type ClipIdentityRole = 'delete-right' | 'delete-discard' | 'duplicate-copy';

type ClipIdentityRequest = {
    role: ClipIdentityRole;
    sourceTrackId: string;
    sourceClipId: string;
};

type ClipReplayIdentity = ClipIdentityRequest & {
    targetClipId: string;
};

type MidiPreparation = ReturnType<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']>;
type MidiReplayPlan = MidiPreparation['replayPlan'];

type GlobalTimeReplayPlan = {
    version: 1;
    operation: GlobalTimeOperation;
    clips: readonly ClipReplayIdentity[];
    midi: MidiReplayPlan;
};

type ExecuteGlobalTimeOperationInput = {
    operation: GlobalTimeOperation;
    replayPlan?: GlobalTimeReplayPlan;
};

type AppliedGlobalTimeResult = {
    status: 'applied';
    hasChanges: true;
    replayPlan: GlobalTimeReplayPlan;
    inversePlan: Record<string, unknown>;
};

type NoChangeGlobalTimeResult = {
    status: 'no-change';
    hasChanges: false;
    replayPlan: GlobalTimeReplayPlan;
    inversePlan: null;
};

type RejectedGlobalTimeResult = {
    status: 'rejected';
    hasChanges: false;
    replayPlan: null;
    inversePlan: null;
};

type GlobalTimeResult = AppliedGlobalTimeResult | NoChangeGlobalTimeResult | RejectedGlobalTimeResult;

type NormalizedOwner = {
    id: string;
    source: Track;
    clips: readonly {
        id: string;
        source: Clip;
    }[];
    acceptsClipUpdate: boolean;
};

type PreparedHandle = {
    name: string;
    hasChanges: boolean;
    apply: () => boolean;
    revert: () => boolean;
};

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

type PlannedLocalState = {
    trackState: TrackState;
    markerState: MarkerStoreState;
    clipIdentities: readonly ClipReplayIdentity[];
    midiOperation:
        | InsertGlobalTimeOperation
        | (DeleteGlobalTimeOperation & {
              splits: readonly {
                  sourceClipId: string;
                  newClipId: string;
                  splitBeat: number;
                  discardBeforeBeat?: number;
              }[];
              removeClipIds: readonly string[];
          })
        | (DuplicateGlobalTimeOperation & {
              copies: readonly { sourceClipId: string; newClipId: string }[];
          });
};

const INPUT_KEYS = ['operation'] as const;
const INPUT_WITH_REPLAY_KEYS = ['operation', 'replayPlan'] as const;
const INSERT_KEYS = ['type', 'atBeat', 'durationBeats'] as const;
const RANGE_KEYS = ['type', 'startBeat', 'endBeat'] as const;
const REPLAY_KEYS = ['version', 'operation', 'clips', 'midi'] as const;
const CLIP_REPLAY_KEYS = ['role', 'sourceTrackId', 'sourceClipId', 'targetClipId'] as const;

export class UnrecoveredGlobalTimeStateError extends Error {
    readonly originalFailure: unknown;
    readonly compensationFailures: readonly unknown[];

    constructor(originalFailure: unknown, compensationFailures: readonly unknown[]) {
        super('Global time operation left unrecovered partial state', {
            cause: new AggregateError(
                [originalFailure, ...compensationFailures],
                'Global time publication and compensation both failed'
            ),
        });
        this.name = 'UnrecoveredGlobalTimeStateError';
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

function hasExactOptionalReplayKey(value: Record<string, unknown>): boolean {
    if (Object.hasOwn(value, 'replayPlan')) {
        return hasExactKeys(value, INPUT_WITH_REPLAY_KEYS);
    }
    return hasExactKeys(value, INPUT_KEYS);
}

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonEmptyId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function validateOperation(value: unknown): GlobalTimeOperation | null {
    if (!isPlainObject(value)) {
        return null;
    }

    if (value.type === 'insert') {
        if (!hasExactKeys(value, INSERT_KEYS)) {
            return null;
        }
        if (!isFiniteNonNegative(value.atBeat)) {
            return null;
        }
        if (typeof value.durationBeats !== 'number' || !Number.isFinite(value.durationBeats)) {
            return null;
        }
        if (value.durationBeats <= 0 || !Number.isFinite(value.atBeat + value.durationBeats)) {
            return null;
        }
        return {
            type: 'insert',
            atBeat: value.atBeat,
            durationBeats: value.durationBeats,
        };
    }

    if (value.type !== 'delete' && value.type !== 'duplicate') {
        return null;
    }
    if (!hasExactKeys(value, RANGE_KEYS)) {
        return null;
    }
    if (!isFiniteNonNegative(value.startBeat)) {
        return null;
    }
    if (typeof value.endBeat !== 'number' || !Number.isFinite(value.endBeat) || value.endBeat <= value.startBeat) {
        return null;
    }

    if (value.type === 'delete') {
        return { type: 'delete', startBeat: value.startBeat, endBeat: value.endBeat };
    }
    return { type: 'duplicate', startBeat: value.startBeat, endBeat: value.endBeat };
}

function operationsMatch(left: GlobalTimeOperation, right: GlobalTimeOperation): boolean {
    if (left.type !== right.type) {
        return false;
    }
    if (left.type === 'insert' && right.type === 'insert') {
        return left.atBeat === right.atBeat && left.durationBeats === right.durationBeats;
    }
    if (left.type === 'insert' || right.type === 'insert') {
        return false;
    }
    return left.startBeat === right.startBeat && left.endBeat === right.endBeat;
}

function validateInput(input: unknown): {
    operation: GlobalTimeOperation;
    suppliedReplayPlan: unknown;
} | null {
    if (!isPlainObject(input) || !hasExactOptionalReplayKey(input)) {
        return null;
    }

    const operation = validateOperation(input.operation);
    if (!operation) {
        return null;
    }

    return {
        operation,
        suppliedReplayPlan: input.replayPlan,
    };
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function validateClip(value: unknown): value is Clip {
    if (!isPlainObject(value)) {
        return false;
    }
    if (!isNonEmptyId(value.id) || !isNonEmptyId(value.trackId)) {
        return false;
    }
    if (
        !isFiniteNonNegative(value.startBeat) ||
        !isFiniteNonNegative(value.endBeat) ||
        value.endBeat <= value.startBeat
    ) {
        return false;
    }
    if (value.type !== 'audio' && value.type !== 'midi') {
        return false;
    }
    if (value.midiOffsetBeats !== undefined) {
        if (typeof value.midiOffsetBeats !== 'number' || !Number.isFinite(value.midiOffsetBeats)) {
            return false;
        }
    }
    if (value.audioOffsetBeats !== undefined) {
        if (typeof value.audioOffsetBeats !== 'number' || !Number.isFinite(value.audioOffsetBeats)) {
            return false;
        }
    }
    if (typeof value.fadeInBeats !== 'number' || typeof value.fadeOutBeats !== 'number') {
        return false;
    }
    if (typeof value.gain !== 'number' || typeof value.color !== 'string') {
        return false;
    }
    if (typeof value.locked !== 'boolean' || typeof value.muted !== 'boolean') {
        return false;
    }
    return true;
}

function validateOwners(state: TrackState): readonly NormalizedOwner[] | null {
    const normalized = createClipWriteTargetIndex(state);
    if (normalized.status !== 'valid') {
        return null;
    }

    for (const owner of normalized.tracks) {
        for (const normalizedClip of owner.clips) {
            if (!validateClip(normalizedClip.source)) {
                return null;
            }
        }
    }
    return normalized.tracks;
}

function isValidComputedTime(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function isValidComputedOffset(value: number): boolean {
    return Number.isFinite(value);
}

function hasValidInsertedClipTimes(clip: Clip, operation: InsertGlobalTimeOperation): boolean {
    if (clip.endBeat <= operation.atBeat) {
        return true;
    }
    if (clip.startBeat >= operation.atBeat) {
        if (!isValidComputedTime(clip.startBeat + operation.durationBeats)) {
            return false;
        }
        return isValidComputedTime(clip.endBeat + operation.durationBeats);
    }
    return isValidComputedTime(clip.endBeat + operation.durationBeats);
}

function hasValidDeleteOffset(clip: Clip, operationEndBeat: number): boolean {
    const audioOffsetBeats = clip.audioOffsetBeats ?? 0;
    return isValidComputedOffset(audioOffsetBeats + (operationEndBeat - clip.startBeat));
}

function hasValidDeleteMidiSplitTimes(clip: Clip, splitTimelineBeat: number, discardTimelineBeat: number): boolean {
    if (clip.type !== 'midi') {
        return true;
    }
    const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
    if (!isValidComputedTime(splitTimelineBeat - clip.startBeat + midiOffsetBeats)) {
        return false;
    }
    return isValidComputedTime(discardTimelineBeat - clip.startBeat + midiOffsetBeats);
}

function hasValidDeletedClipTimes(clip: Clip, operation: DeleteGlobalTimeOperation): boolean {
    const durationBeats = operation.endBeat - operation.startBeat;
    if (clip.endBeat <= operation.startBeat) {
        return true;
    }
    if (clip.startBeat >= operation.endBeat) {
        if (!isValidComputedTime(clip.startBeat - durationBeats)) {
            return false;
        }
        return isValidComputedTime(clip.endBeat - durationBeats);
    }
    if (clip.startBeat >= operation.startBeat && clip.endBeat <= operation.endBeat) {
        return true;
    }
    if (clip.startBeat < operation.startBeat && clip.endBeat > operation.endBeat) {
        if (!isValidComputedTime(clip.endBeat - durationBeats)) {
            return false;
        }
        if (!hasValidDeleteOffset(clip, operation.endBeat)) {
            return false;
        }
        return hasValidDeleteMidiSplitTimes(clip, operation.endBeat, operation.startBeat);
    }
    if (clip.startBeat < operation.startBeat) {
        return hasValidDeleteMidiSplitTimes(clip, operation.startBeat, operation.startBeat);
    }
    if (!isValidComputedTime(clip.endBeat - durationBeats)) {
        return false;
    }
    if (!hasValidDeleteOffset(clip, operation.endBeat)) {
        return false;
    }
    return hasValidDeleteMidiSplitTimes(clip, operation.endBeat, operation.endBeat);
}

function hasValidInsertedMarkerTimes(state: MarkerStoreState, operation: InsertGlobalTimeOperation): boolean {
    for (const marker of state.markers) {
        if (marker.beat >= operation.atBeat && !isValidComputedTime(marker.beat + operation.durationBeats)) {
            return false;
        }
    }
    return true;
}

function hasValidDeletedMarkerTimes(state: MarkerStoreState, operation: DeleteGlobalTimeOperation): boolean {
    const durationBeats = operation.endBeat - operation.startBeat;
    for (const marker of state.markers) {
        if (marker.beat >= operation.endBeat && !isValidComputedTime(marker.beat - durationBeats)) {
            return false;
        }
    }
    for (const section of state.sections) {
        if (section.endBeat <= operation.startBeat) {
            continue;
        }
        if (section.startBeat >= operation.endBeat) {
            if (!isValidComputedTime(section.startBeat - durationBeats)) {
                return false;
            }
            if (!isValidComputedTime(section.endBeat - durationBeats)) {
                return false;
            }
            continue;
        }
        if (section.startBeat >= operation.startBeat && section.endBeat <= operation.endBeat) {
            continue;
        }
        if (section.startBeat < operation.startBeat && section.endBeat > operation.endBeat) {
            if (!isValidComputedTime(section.endBeat - durationBeats)) {
                return false;
            }
            continue;
        }
        if (section.startBeat >= operation.startBeat && !isValidComputedTime(section.endBeat - durationBeats)) {
            return false;
        }
    }
    return true;
}

function hasValidDuplicateCopyTimes(clip: Clip, operation: DuplicateGlobalTimeOperation): boolean {
    if (clip.startBeat < operation.startBeat || clip.endBeat > operation.endBeat) {
        return true;
    }
    const durationBeats = operation.endBeat - operation.startBeat;
    if (!isValidComputedTime(clip.startBeat + durationBeats)) {
        return false;
    }
    return isValidComputedTime(clip.endBeat + durationBeats);
}

function hasValidComputedTimes(
    owners: readonly NormalizedOwner[],
    markerState: MarkerStoreState,
    operation: GlobalTimeOperation
): boolean {
    let insertionOperation: InsertGlobalTimeOperation | null = null;
    if (operation.type === 'insert') {
        insertionOperation = operation;
    }
    if (operation.type === 'duplicate') {
        insertionOperation = {
            type: 'insert',
            atBeat: operation.endBeat,
            durationBeats: operation.endBeat - operation.startBeat,
        };
    }

    for (const owner of owners) {
        if (!owner.acceptsClipUpdate) {
            continue;
        }
        for (const normalizedClip of owner.clips) {
            const clip = normalizedClip.source;
            if (insertionOperation && !hasValidInsertedClipTimes(clip, insertionOperation)) {
                return false;
            }
            if (operation.type === 'duplicate' && !hasValidDuplicateCopyTimes(clip, operation)) {
                return false;
            }
            if (operation.type === 'delete' && !hasValidDeletedClipTimes(clip, operation)) {
                return false;
            }
        }
    }

    if (insertionOperation) {
        return hasValidInsertedMarkerTimes(markerState, insertionOperation);
    }
    if (operation.type !== 'delete') {
        return false;
    }
    return hasValidDeletedMarkerTimes(markerState, operation);
}

function validateMarkerState(state: MarkerStoreState | null): state is MarkerStoreState {
    if (!state || !Array.isArray(state.markers) || !Array.isArray(state.sections)) {
        return false;
    }

    const markerIds = new Set<string>();
    for (const marker of state.markers) {
        if (!isNonEmptyId(marker.id) || markerIds.has(marker.id) || !isFiniteNonNegative(marker.beat)) {
            return false;
        }
        markerIds.add(marker.id);
    }

    const sectionIds = new Set<string>();
    for (const section of state.sections) {
        if (
            !isNonEmptyId(section.id) ||
            sectionIds.has(section.id) ||
            !isFiniteNonNegative(section.startBeat) ||
            !isFiniteNonNegative(section.endBeat) ||
            section.endBeat < section.startBeat
        ) {
            return false;
        }
        sectionIds.add(section.id);
    }
    return true;
}

function createAutomationOwners(owners: readonly NormalizedOwner[]) {
    return owners.map((owner) => ({
        trackId: owner.id,
        eligible: owner.acceptsClipUpdate,
        clipIds: owner.clips.map((clip) => clip.id),
    }));
}

function createMidiOwners(owners: readonly NormalizedOwner[]) {
    return owners.map((owner) => ({
        trackId: owner.id,
        eligible: owner.acceptsClipUpdate,
        clips: owner.clips.map((clip) => {
            const source = clip.source;
            if (source.midiOffsetBeats === undefined) {
                return {
                    clipId: clip.id,
                    startBeat: source.startBeat,
                    endBeat: source.endBeat,
                };
            }
            return {
                clipId: clip.id,
                startBeat: source.startBeat,
                endBeat: source.endBeat,
                midiOffsetBeats: source.midiOffsetBeats,
            };
        }),
    }));
}

function toOwnerTimeOperation(operation: GlobalTimeOperation) {
    if (operation.type === 'insert') {
        return operation;
    }
    if (operation.type === 'delete') {
        return operation;
    }
    return {
        type: 'insert' as const,
        atBeat: operation.endBeat,
        durationBeats: operation.endBeat - operation.startBeat,
    };
}

function createClipIdentityRequests(
    owners: readonly NormalizedOwner[],
    operation: GlobalTimeOperation
): readonly ClipIdentityRequest[] {
    if (operation.type === 'insert') {
        return [];
    }

    const requests: ClipIdentityRequest[] = [];
    for (const owner of owners) {
        if (!owner.acceptsClipUpdate) {
            continue;
        }
        for (const normalizedClip of owner.clips) {
            const clip = normalizedClip.source;
            if (operation.type === 'duplicate') {
                if (clip.startBeat >= operation.startBeat && clip.endBeat <= operation.endBeat) {
                    requests.push({
                        role: 'duplicate-copy',
                        sourceTrackId: owner.id,
                        sourceClipId: clip.id,
                    });
                }
                continue;
            }

            if (clip.startBeat < operation.startBeat && clip.endBeat > operation.endBeat) {
                requests.push({
                    role: 'delete-right',
                    sourceTrackId: owner.id,
                    sourceClipId: clip.id,
                });
                continue;
            }
            if (clip.startBeat < operation.startBeat && clip.endBeat > operation.startBeat) {
                if (clip.type === 'midi') {
                    requests.push({
                        role: 'delete-discard',
                        sourceTrackId: owner.id,
                        sourceClipId: clip.id,
                    });
                }
                continue;
            }
            if (clip.startBeat < operation.endBeat && clip.endBeat > operation.endBeat) {
                requests.push({
                    role: 'delete-right',
                    sourceTrackId: owner.id,
                    sourceClipId: clip.id,
                });
            }
        }
    }
    return requests;
}

/**
 * Clip ids this operation takes out of the arrangement — deleted outright, or
 * re-identified because the surviving fragment starts inside the deleted range
 * and is re-keyed. Mirrors `prepareDeletedTracks` branch for branch; the caller
 * cross-checks the result against the prepared track state before publishing.
 *
 * Insert never touches identity. Duplicate only mints new ids, so neither
 * retires one.
 */
function collectRetiredClipIds(owners: readonly NormalizedOwner[], operation: GlobalTimeOperation): readonly string[] {
    if (operation.type !== 'delete') {
        return [];
    }

    const retiredClipIds: string[] = [];
    for (const owner of owners) {
        if (!owner.acceptsClipUpdate) {
            continue;
        }
        for (const normalizedClip of owner.clips) {
            const clip = normalizedClip.source;
            if (clip.endBeat <= operation.startBeat || clip.startBeat >= operation.endBeat) {
                continue;
            }
            if (clip.startBeat >= operation.startBeat && clip.endBeat <= operation.endBeat) {
                // Fully inside the deleted range: the clip goes away.
                retiredClipIds.push(clip.id);
                continue;
            }
            if (clip.startBeat < operation.startBeat) {
                // The left fragment keeps the original id.
                continue;
            }
            // Starts inside the range and outlives it: survives under a new id.
            retiredClipIds.push(clip.id);
        }
    }
    return retiredClipIds;
}

function collectTrackStateClipIds(state: TrackState): ReadonlySet<string> {
    const clipIds = new Set<string>();
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            clipIds.add(clip.id);
        }
    }
    return clipIds;
}

/**
 * The retired set has to be exactly the ids the prepared track state drops.
 * A miss in either direction would either strand satellite data or delete a
 * live clip's automation, so the operation refuses rather than guessing.
 */
function retiredClipIdsMatchPreparedState(
    retiredClipIds: readonly string[],
    existingClipIds: ReadonlySet<string>,
    nextTrackState: TrackState
): boolean {
    const survivingClipIds = collectTrackStateClipIds(nextTrackState);
    const retired = new Set(retiredClipIds);
    if (retired.size !== retiredClipIds.length) {
        return false;
    }
    for (const clipId of existingClipIds) {
        if (survivingClipIds.has(clipId) === retired.has(clipId)) {
            return false;
        }
    }
    for (const clipId of retired) {
        if (!existingClipIds.has(clipId)) {
            return false;
        }
    }
    return true;
}

function clipReplayMatchesRequest(value: unknown, request: ClipIdentityRequest): value is ClipReplayIdentity {
    if (!isPlainObject(value) || !hasExactKeys(value, CLIP_REPLAY_KEYS)) {
        return false;
    }
    return (
        value.role === request.role &&
        value.sourceTrackId === request.sourceTrackId &&
        value.sourceClipId === request.sourceClipId &&
        isNonEmptyId(value.targetClipId)
    );
}

function isValidSuppliedReplayPlan(
    value: unknown,
    operation: GlobalTimeOperation,
    requests: readonly ClipIdentityRequest[],
    existingClipIds: ReadonlySet<string>
): value is GlobalTimeReplayPlan {
    if (!isPlainObject(value) || !hasExactKeys(value, REPLAY_KEYS) || value.version !== 1) {
        return false;
    }
    const replayOperation = validateOperation(value.operation);
    if (!replayOperation || !operationsMatch(operation, replayOperation)) {
        return false;
    }
    if (!isUnknownArray(value.clips) || value.clips.length !== requests.length) {
        return false;
    }

    const replayClips = value.clips;
    const targetIds = new Set<string>();
    for (const [index, request] of requests.entries()) {
        const replayClip = replayClips[index];
        if (!clipReplayMatchesRequest(replayClip, request)) {
            return false;
        }
        if (existingClipIds.has(replayClip.targetClipId) || targetIds.has(replayClip.targetClipId)) {
            return false;
        }
        targetIds.add(replayClip.targetClipId);
    }

    return true;
}

function allocateClipReplayPlan(
    requests: readonly ClipIdentityRequest[],
    existingClipIds: ReadonlySet<string>
): readonly ClipReplayIdentity[] | null {
    const targetIds = new Set<string>();
    const identities: ClipReplayIdentity[] = [];
    for (const request of requests) {
        const randomId = crypto.randomUUID();
        let targetClipId = `clip-dt-${randomId.slice(0, 8)}`;
        if (request.role === 'delete-discard') {
            targetClipId = `clip-dt-discard-${randomId.slice(0, 8)}`;
        }
        if (request.role === 'duplicate-copy') {
            targetClipId = `clip-dup-${randomId}`;
        }
        if (existingClipIds.has(targetClipId) || targetIds.has(targetClipId)) {
            return null;
        }
        targetIds.add(targetClipId);
        identities.push({ ...request, targetClipId });
    }
    return identities;
}

function indexClipIdentities(identities: readonly ClipReplayIdentity[]): ReadonlyMap<string, ClipReplayIdentity> {
    const index = new Map<string, ClipReplayIdentity>();
    for (const identity of identities) {
        index.set(`${identity.role}:${identity.sourceTrackId}:${identity.sourceClipId}`, identity);
    }
    return index;
}

function getClipIdentity(
    index: ReadonlyMap<string, ClipReplayIdentity>,
    role: ClipIdentityRole,
    trackId: string,
    clipId: string
): ClipReplayIdentity {
    const identity = index.get(`${role}:${trackId}:${clipId}`);
    if (!identity) {
        throw new Error(`Missing prepared ${role} identity for clip ${clipId}`);
    }
    return identity;
}

function insertClipGeometry(clip: Clip, operation: InsertGlobalTimeOperation): Clip {
    if (clip.endBeat <= operation.atBeat) {
        return clip;
    }
    if (clip.startBeat >= operation.atBeat) {
        return {
            ...clip,
            startBeat: clip.startBeat + operation.durationBeats,
            endBeat: clip.endBeat + operation.durationBeats,
        };
    }
    return {
        ...clip,
        endBeat: clip.endBeat + operation.durationBeats,
    };
}

function prepareInsertedTracks(
    state: TrackState,
    owners: readonly NormalizedOwner[],
    operation: InsertGlobalTimeOperation
): TrackState {
    let changed = false;
    const tracks: Track[] = [];
    for (const owner of owners) {
        if (!owner.acceptsClipUpdate) {
            tracks.push(owner.source);
            continue;
        }
        let trackChanged = false;
        const clips: Clip[] = [];
        for (const normalizedClip of owner.clips) {
            const clip = insertClipGeometry(normalizedClip.source, operation);
            if (clip !== normalizedClip.source) {
                trackChanged = true;
            }
            clips.push(clip);
        }
        if (!trackChanged) {
            tracks.push(owner.source);
            continue;
        }
        changed = true;
        tracks.push({ ...owner.source, clips });
    }
    if (!changed) {
        return state;
    }
    return { ...state, tracks };
}

function prepareDeletedTracks(
    state: TrackState,
    owners: readonly NormalizedOwner[],
    operation: DeleteGlobalTimeOperation,
    identities: readonly ClipReplayIdentity[]
): {
    state: TrackState;
    splits: Array<{
        sourceClipId: string;
        newClipId: string;
        splitBeat: number;
        discardBeforeBeat?: number;
    }>;
    removeClipIds: string[];
} {
    const duration = operation.endBeat - operation.startBeat;
    const identityIndex = indexClipIdentities(identities);
    const splits: Array<{
        sourceClipId: string;
        newClipId: string;
        splitBeat: number;
        discardBeforeBeat?: number;
    }> = [];
    const removeClipIds: string[] = [];
    let changed = false;
    const tracks: Track[] = [];

    for (const owner of owners) {
        if (!owner.acceptsClipUpdate) {
            tracks.push(owner.source);
            continue;
        }
        let trackChanged = false;
        const clips: Clip[] = [];
        for (const normalizedClip of owner.clips) {
            const clip = normalizedClip.source;
            if (clip.endBeat <= operation.startBeat) {
                clips.push(clip);
                continue;
            }
            if (clip.startBeat >= operation.endBeat) {
                trackChanged = true;
                clips.push({
                    ...clip,
                    startBeat: clip.startBeat - duration,
                    endBeat: clip.endBeat - duration,
                });
                continue;
            }
            if (clip.startBeat >= operation.startBeat && clip.endBeat <= operation.endBeat) {
                trackChanged = true;
                removeClipIds.push(clip.id);
                continue;
            }
            if (clip.startBeat < operation.startBeat && clip.endBeat > operation.endBeat) {
                trackChanged = true;
                const identity = getClipIdentity(identityIndex, 'delete-right', owner.id, clip.id);
                clips.push(
                    { ...clip, endBeat: operation.startBeat, name: `${clip.name} (L)` },
                    {
                        ...clip,
                        id: identity.targetClipId,
                        startBeat: operation.startBeat,
                        endBeat: clip.endBeat - duration,
                        name: `${clip.name} (R)`,
                        audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (operation.endBeat - clip.startBeat),
                        midiOffsetBeats: 0,
                    }
                );
                if (clip.type === 'midi') {
                    splits.push({
                        sourceClipId: clip.id,
                        newClipId: identity.targetClipId,
                        splitBeat: operation.endBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0),
                        discardBeforeBeat: operation.startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0),
                    });
                }
                continue;
            }
            if (clip.startBeat < operation.startBeat) {
                trackChanged = true;
                clips.push({ ...clip, endBeat: operation.startBeat });
                if (clip.type === 'midi') {
                    const mediaSplit = operation.startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
                    const identity = getClipIdentity(identityIndex, 'delete-discard', owner.id, clip.id);
                    splits.push({
                        sourceClipId: clip.id,
                        newClipId: identity.targetClipId,
                        splitBeat: mediaSplit,
                        discardBeforeBeat: mediaSplit,
                    });
                    removeClipIds.push(identity.targetClipId);
                }
                continue;
            }

            trackChanged = true;
            const identity = getClipIdentity(identityIndex, 'delete-right', owner.id, clip.id);
            clips.push({
                ...clip,
                id: identity.targetClipId,
                startBeat: operation.startBeat,
                endBeat: clip.endBeat - duration,
                audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (operation.endBeat - clip.startBeat),
                midiOffsetBeats: 0,
            });
            if (clip.type === 'midi') {
                const mediaSplit = operation.endBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
                splits.push({
                    sourceClipId: clip.id,
                    newClipId: identity.targetClipId,
                    splitBeat: mediaSplit,
                    discardBeforeBeat: mediaSplit,
                });
                removeClipIds.push(clip.id);
            }
        }
        if (!trackChanged) {
            tracks.push(owner.source);
            continue;
        }
        changed = true;
        tracks.push({ ...owner.source, clips });
    }

    if (!changed) {
        return { state, splits, removeClipIds };
    }
    return {
        state: { ...state, tracks },
        splits,
        removeClipIds,
    };
}

function prepareDuplicatedTracks(
    state: TrackState,
    owners: readonly NormalizedOwner[],
    operation: DuplicateGlobalTimeOperation,
    identities: readonly ClipReplayIdentity[]
): {
    state: TrackState;
    copies: Array<{ sourceClipId: string; newClipId: string }>;
} {
    const duration = operation.endBeat - operation.startBeat;
    const insertOperation: InsertGlobalTimeOperation = {
        type: 'insert',
        atBeat: operation.endBeat,
        durationBeats: duration,
    };
    const identityIndex = indexClipIdentities(identities);
    const copies: Array<{ sourceClipId: string; newClipId: string }> = [];
    let changed = false;
    const tracks: Track[] = [];

    for (const owner of owners) {
        if (!owner.acceptsClipUpdate) {
            tracks.push(owner.source);
            continue;
        }
        let trackChanged = false;
        const clips: Clip[] = [];
        for (const normalizedClip of owner.clips) {
            const shifted = insertClipGeometry(normalizedClip.source, insertOperation);
            if (shifted !== normalizedClip.source) {
                trackChanged = true;
            }
            clips.push(shifted);
        }
        for (const normalizedClip of owner.clips) {
            const clip = normalizedClip.source;
            if (clip.startBeat < operation.startBeat || clip.endBeat > operation.endBeat) {
                continue;
            }
            trackChanged = true;
            const identity = getClipIdentity(identityIndex, 'duplicate-copy', owner.id, clip.id);
            clips.push({
                ...clip,
                id: identity.targetClipId,
                startBeat: clip.startBeat + duration,
                endBeat: clip.endBeat + duration,
            });
            if (clip.type === 'midi') {
                copies.push({ sourceClipId: clip.id, newClipId: identity.targetClipId });
            }
        }
        if (!trackChanged) {
            tracks.push(owner.source);
            continue;
        }
        changed = true;
        tracks.push({ ...owner.source, clips });
    }

    if (!changed) {
        return { state, copies };
    }
    return {
        state: { ...state, tracks },
        copies,
    };
}

function prepareInsertedMarkerState(state: MarkerStoreState, operation: InsertGlobalTimeOperation): MarkerStoreState {
    const markers = [];
    for (const marker of state.markers) {
        if (marker.beat < operation.atBeat) {
            markers.push(marker);
            continue;
        }
        markers.push({ ...marker, beat: marker.beat + operation.durationBeats });
    }
    if (markers.every((marker, index) => marker === state.markers[index])) {
        return state;
    }
    return { ...state, markers };
}

function allocateRightSectionFragmentId(input: {
    sourceId: string;
    operation: DeleteGlobalTimeOperation;
    usedIds: Set<string>;
}): string {
    const baseId = `${input.sourceId}:time-delete-right:${input.operation.startBeat}:${input.operation.endBeat}`;
    let candidate = baseId;
    let suffix = 1;
    while (input.usedIds.has(candidate)) {
        candidate = `${baseId}:${suffix}`;
        suffix += 1;
    }
    input.usedIds.add(candidate);
    return candidate;
}

function prepareDeletedMarkerState(state: MarkerStoreState, operation: DeleteGlobalTimeOperation): MarkerStoreState {
    const duration = operation.endBeat - operation.startBeat;
    let changed = false;
    const markers = [];
    for (const marker of state.markers) {
        if (marker.beat >= operation.startBeat && marker.beat < operation.endBeat) {
            changed = true;
            continue;
        }
        if (marker.beat >= operation.endBeat) {
            changed = true;
            markers.push({ ...marker, beat: marker.beat - duration });
            continue;
        }
        markers.push(marker);
    }

    const sections = [];
    const usedSectionIds = new Set(state.sections.map((section) => section.id));
    for (const section of state.sections) {
        if (section.endBeat <= operation.startBeat) {
            sections.push(section);
            continue;
        }
        if (section.startBeat >= operation.endBeat) {
            changed = true;
            sections.push({
                ...section,
                startBeat: section.startBeat - duration,
                endBeat: section.endBeat - duration,
            });
            continue;
        }
        if (section.startBeat >= operation.startBeat && section.endBeat <= operation.endBeat) {
            changed = true;
            continue;
        }
        if (section.startBeat < operation.startBeat && section.endBeat > operation.endBeat) {
            changed = true;
            const rightSectionId = allocateRightSectionFragmentId({
                sourceId: section.id,
                operation,
                usedIds: usedSectionIds,
            });
            sections.push(
                {
                    ...section,
                    endBeat: operation.startBeat,
                    name: `${section.name} (L)`,
                },
                {
                    ...section,
                    id: rightSectionId,
                    startBeat: operation.startBeat,
                    endBeat: section.endBeat - duration,
                    name: `${section.name} (R)`,
                }
            );
            continue;
        }
        if (section.startBeat < operation.startBeat) {
            changed = true;
            sections.push({ ...section, endBeat: operation.startBeat });
            continue;
        }
        changed = true;
        sections.push({
            ...section,
            startBeat: operation.startBeat,
            endBeat: section.endBeat - duration,
        });
    }

    if (!changed) {
        return state;
    }
    return { ...state, markers, sections };
}

function prepareLocalState(
    trackState: TrackState,
    markerState: MarkerStoreState,
    owners: readonly NormalizedOwner[],
    operation: GlobalTimeOperation,
    clipIdentities: readonly ClipReplayIdentity[]
): PlannedLocalState {
    if (operation.type === 'insert') {
        return {
            trackState: prepareInsertedTracks(trackState, owners, operation),
            markerState: prepareInsertedMarkerState(markerState, operation),
            clipIdentities,
            midiOperation: operation,
        };
    }
    if (operation.type === 'duplicate') {
        const duplicated = prepareDuplicatedTracks(trackState, owners, operation, clipIdentities);
        const insertOperation: InsertGlobalTimeOperation = {
            type: 'insert',
            atBeat: operation.endBeat,
            durationBeats: operation.endBeat - operation.startBeat,
        };
        return {
            trackState: duplicated.state,
            markerState: prepareInsertedMarkerState(markerState, insertOperation),
            clipIdentities,
            midiOperation: {
                ...operation,
                copies: duplicated.copies,
            },
        };
    }

    const deleted = prepareDeletedTracks(trackState, owners, operation, clipIdentities);
    return {
        trackState: deleted.state,
        markerState: prepareDeletedMarkerState(markerState, operation),
        clipIdentities,
        midiOperation: {
            ...operation,
            splits: deleted.splits,
            removeClipIds: deleted.removeClipIds,
        },
    };
}

function createLocalHandle<TState>(input: {
    name: string;
    capturedState: TState;
    nextState: TState;
    read: () => TState | null;
    write: (state: TState) => void;
}): PreparedHandle {
    const hasChanges = input.capturedState !== input.nextState;
    let phase: TransactionPhase = 'closed';
    if (hasChanges) {
        phase = 'prepared';
    }

    function apply(): boolean {
        if (phase === 'publishing') {
            return false;
        }
        if (phase !== 'prepared') {
            phase = 'closed';
            return false;
        }
        if (input.read() !== input.capturedState) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            input.write(input.nextState);
        } catch (error) {
            const publishedState = input.read();
            if (publishedState === input.nextState) {
                phase = 'applied';
                const compensationFailures: unknown[] = [];
                try {
                    if (!revert()) {
                        compensationFailures.push(new Error(`${input.name} compensation returned false`));
                    }
                } catch (error) {
                    compensationFailures.push(error);
                }
                if (compensationFailures.length > 0) {
                    throw new UnrecoveredGlobalTimeStateError(error, compensationFailures);
                }
                throw error;
            }
            phase = 'closed';
            if (publishedState !== input.capturedState) {
                const unsafeCompensation = new Error(
                    `${input.name} cannot safely compensate an unexpected published reference`
                );
                throw new UnrecoveredGlobalTimeStateError(error, [unsafeCompensation]);
            }
            throw error;
        }
        const publishedState = input.read();
        if (publishedState !== input.nextState) {
            phase = 'closed';
            if (publishedState !== input.capturedState) {
                const verificationFailure = new Error(`${input.name} did not publish the prepared state`);
                const unsafeCompensation = new Error(
                    `${input.name} cannot safely compensate an unexpected published reference`
                );
                throw new UnrecoveredGlobalTimeStateError(verificationFailure, [unsafeCompensation]);
            }
            return false;
        }
        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase !== 'applied') {
            phase = 'closed';
            return false;
        }
        if (input.read() !== input.nextState) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            input.write(input.capturedState);
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        phase = 'closed';
        return input.read() === input.capturedState;
    }

    return {
        name: input.name,
        hasChanges,
        apply,
        revert,
    };
}

function asPreparedHandle(
    name: string,
    preparation: { hasChanges: boolean; apply: () => boolean; revert: () => boolean }
) {
    return {
        name,
        hasChanges: preparation.hasChanges,
        apply: preparation.apply,
        revert: preparation.revert,
    };
}

function collectExistingClipIds(owners: readonly NormalizedOwner[]): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const owner of owners) {
        for (const clip of owner.clips) {
            ids.add(clip.id);
        }
    }
    return ids;
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
            failures.push(error);
        }
    }
    return failures;
}

function cloneOwnerInversePlan(preparation: {
    hasChanges: boolean;
    inversePlan: Record<string, unknown> | null;
}): Record<string, unknown> | null | false {
    if (!preparation.hasChanges) {
        if (preparation.inversePlan !== null) {
            return false;
        }
        return null;
    }
    if (preparation.inversePlan === null) {
        return false;
    }

    const cloned = timeOperationStateCodec.cloneJsonPlan(preparation.inversePlan);
    if (cloned) {
        return cloned;
    }
    const encoded = timeOperationStateCodec.encodeOpaqueJsonPlan(preparation.inversePlan);
    if (!encoded) {
        return false;
    }
    return encoded;
}

function createCombinedInversePlan(input: {
    expectedTrackState: TrackState;
    replacementTrackState: TrackState;
    expectedMarkerState: MarkerStoreState;
    replacementMarkerState: MarkerStoreState;
    automationPreparation: ReturnType<TimeOperationDependencies['prepareAutomationTimeOperation']>;
    midiPreparation: ReturnType<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']>;
    timelineMapPreparation: ReturnType<TimeOperationDependencies['prepareTimelineMapTimeOperation']>;
    clipSatellitePreparation: { hasChanges: boolean; inversePlan: Record<string, unknown> | null };
}): Record<string, unknown> | null {
    const expectedTrackState = timeOperationStateCodec.encodeTrackState(input.expectedTrackState);
    const replacementTrackState = timeOperationStateCodec.encodeTrackState(input.replacementTrackState);
    const expectedMarkerState = timeOperationStateCodec.encodeMarkerState(input.expectedMarkerState);
    const replacementMarkerState = timeOperationStateCodec.encodeMarkerState(input.replacementMarkerState);
    if (!expectedTrackState || !replacementTrackState || !expectedMarkerState || !replacementMarkerState) {
        return null;
    }

    const automation = cloneOwnerInversePlan(input.automationPreparation);
    const midi = cloneOwnerInversePlan(input.midiPreparation);
    const timelineMap = cloneOwnerInversePlan(input.timelineMapPreparation);
    const clipSatellites = cloneOwnerInversePlan(input.clipSatellitePreparation);
    if (automation === false || midi === false || timelineMap === false || clipSatellites === false) {
        return null;
    }

    return {
        version: 1,
        scope: 'global',
        local: {
            version: 1,
            expected: {
                trackState: expectedTrackState,
                markerState: expectedMarkerState,
            },
            replacement: {
                trackState: replacementTrackState,
                markerState: replacementMarkerState,
            },
        },
        automation,
        midi,
        timelineMap,
        clipSatellites,
    };
}

function rejectResult(): RejectedGlobalTimeResult {
    return {
        status: 'rejected',
        hasChanges: false,
        replayPlan: null,
        inversePlan: null,
    };
}

export function executeGlobalTimeOperation(input: ExecuteGlobalTimeOperationInput): GlobalTimeResult {
    const deps = timeOperationDependencies;
    if (!deps) {
        throw new Error('Arrangement time operation dependencies are not registered');
    }

    const validatedInput = validateInput(input);
    if (!validatedInput) {
        return rejectResult();
    }

    const trackState = getTrackState();
    if (!trackState) {
        return rejectResult();
    }
    const owners = validateOwners(trackState);
    const markerState = markerStore.value;
    if (!owners || !validateMarkerState(markerState)) {
        return rejectResult();
    }
    if (!hasValidComputedTimes(owners, markerState, validatedInput.operation)) {
        return rejectResult();
    }

    const ownerOperation = toOwnerTimeOperation(validatedInput.operation);
    const retiredClipIds = collectRetiredClipIds(owners, validatedInput.operation);
    const automationPreparation = deps.prepareAutomationTimeOperation({
        operation: ownerOperation,
        owners: createAutomationOwners(owners),
        removedClipIds: retiredClipIds,
    });
    if (automationPreparation.status !== 'ready') {
        return rejectResult();
    }
    const transportPreparation = deps.prepareTimelineMapTimeOperation({
        operation: ownerOperation,
    });
    if (transportPreparation.status !== 'ready') {
        return rejectResult();
    }

    const existingClipIds = collectExistingClipIds(owners);
    const clipRequests = createClipIdentityRequests(owners, validatedInput.operation);
    let clipIdentities: readonly ClipReplayIdentity[];
    let suppliedReplayPlan: GlobalTimeReplayPlan | null = null;
    if (validatedInput.suppliedReplayPlan === undefined) {
        const allocated = allocateClipReplayPlan(clipRequests, existingClipIds);
        if (!allocated) {
            return rejectResult();
        }
        clipIdentities = allocated;
    } else {
        if (
            !isValidSuppliedReplayPlan(
                validatedInput.suppliedReplayPlan,
                validatedInput.operation,
                clipRequests,
                existingClipIds
            )
        ) {
            return rejectResult();
        }
        suppliedReplayPlan = validatedInput.suppliedReplayPlan;
        clipIdentities = suppliedReplayPlan.clips;
    }

    const local = prepareLocalState(trackState, markerState, owners, validatedInput.operation, clipIdentities);
    if (!retiredClipIdsMatchPreparedState(retiredClipIds, existingClipIds, local.trackState)) {
        return rejectResult();
    }
    const clipSatelliteRemovalPlan = createClipSatelliteRemovalPlan(retiredClipIds);
    const clipSatellitePreparation = prepareClipSatelliteStateRestore(clipSatelliteRemovalPlan);
    if (clipSatellitePreparation.status !== 'ready') {
        return rejectResult();
    }
    const midiOwners = createMidiOwners(owners);
    let midiPreparationInput: Parameters<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']>[0] = {
        operation: local.midiOperation,
        owners: midiOwners,
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

    let replayPlan: GlobalTimeReplayPlan;
    if (suppliedReplayPlan) {
        if (midiPreparation.replayPlan !== suppliedReplayPlan.midi) {
            return rejectResult();
        }
        replayPlan = suppliedReplayPlan;
    } else {
        replayPlan = {
            version: 1,
            operation: validatedInput.operation,
            clips: local.clipIdentities,
            midi: midiPreparation.replayPlan,
        };
    }

    const handles: PreparedHandle[] = [
        createLocalHandle({
            name: 'Arrangement',
            capturedState: trackState,
            nextState: local.trackState,
            read: getTrackState,
            write: setTrackState,
        }),
        createLocalHandle({
            name: 'markers',
            capturedState: markerState,
            nextState: local.markerState,
            read: () => markerStore.value,
            write: (state) => markerStore.set(state),
        }),
        asPreparedHandle('Automation', automationPreparation),
        asPreparedHandle('Transport', transportPreparation),
        asPreparedHandle('MIDI', midiPreparation),
        asPreparedHandle('Clip satellites', clipSatellitePreparation),
    ];
    const changedHandles = handles.filter((handle) => handle.hasChanges);
    if (changedHandles.length === 0) {
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
        expectedMarkerState: local.markerState,
        replacementMarkerState: markerState,
        automationPreparation,
        midiPreparation,
        timelineMapPreparation: transportPreparation,
        clipSatellitePreparation: {
            hasChanges: clipSatellitePreparation.hasChanges,
            inversePlan: clipSatellitePreparation.hasChanges
                ? {
                      version: 1,
                      expected: clipSatelliteRemovalPlan.replacement,
                      replacement: clipSatelliteRemovalPlan.expected,
                  }
                : null,
        },
    });
    if (!inversePlan) {
        return rejectResult();
    }

    const appliedAll = batchStoreUpdates(() => {
        const applied: PreparedHandle[] = [];
        for (const handle of changedHandles) {
            let appliedSuccessfully: boolean;
            try {
                appliedSuccessfully = handle.apply();
            } catch (error) {
                const compensationFailures = compensateAppliedHandles(applied);
                if (compensationFailures.length > 0) {
                    throw new UnrecoveredGlobalTimeStateError(error, compensationFailures);
                }
                throw error;
            }

            if (!appliedSuccessfully) {
                const failure = new Error(`${handle.name} publication returned false`);
                const compensationFailures = compensateAppliedHandles(applied);
                if (compensationFailures.length > 0) {
                    throw new UnrecoveredGlobalTimeStateError(failure, compensationFailures);
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
        removeClipSatelliteData(retiredClipIds);
        return true;
    });

    if (!appliedAll) {
        return rejectResult();
    }
    return {
        status: 'applied',
        hasChanges: true,
        replayPlan,
        inversePlan,
    };
}
