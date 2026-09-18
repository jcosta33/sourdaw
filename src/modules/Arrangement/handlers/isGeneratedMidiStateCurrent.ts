import { modulationStore } from '#/modules/Automation/stores';
import { getAutomationLanes } from '#/modules/Automation/useCases';
import { type projectMidiNotesByClipIdThroughRestores, serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';
import { matchesJsonFingerprint } from '#/utils/jsonSemanticEquality';
import { valuesEqual } from '#/utils/structuralEquality';

import { collectTrackClipIds } from '../services/collectTrackClipIds';
import { serializeClipSatelliteEntries, serializeProjectedClipSatelliteEntries } from '../stores/clipSatelliteState';
import { getEnvelope } from '../stores/gainEnvelopeStore';
import { takeLaneStore } from '../stores/takeLaneStore';
import { hasNonDefaultWarpState } from '../stores/warpStates';
import { serializeClipScopedAutomationLanes } from '../useCases/clip/serializeClipScopedAutomationLanes';
import { serializeProjectedClipScopedAutomationLanes } from '../useCases/clip/serializeProjectedClipScopedAutomationLanes';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

import { type ProjectedClipState } from './projectClipThroughPriorBatchActions';

type IsGeneratedMidiStateCurrentInput = {
    entityId: string;
    entityType: 'clip' | 'track';
    guard: GeneratedMidiStateGuard;
    allowedReferencingTrackIds?: readonly string[];
    projectedMidiNotesByClipId?: ReturnType<typeof projectMidiNotesByClipIdThroughRestores>;
    /**
     * Prior batch siblings' restore projection for the clip named by `entityId`
     * (#3814). Present only when a sibling touched the clip's state; the guard
     * then reads what that sibling re-establishes where the plain live read
     * would falsely fail — at preflight time the sibling has not executed yet.
     * Track-entity guards ignore it.
     */
    readonly projectedClipState?: ProjectedClipState;
};

function hasEnvelopeOrWarpState(clipIds: readonly string[]): boolean {
    return clipIds.some((clipId) => getEnvelope(clipId) !== undefined || hasNonDefaultWarpState(clipId));
}

function hasClipScopedAutomationLane(clipIds: readonly string[]): boolean {
    const clipIdSet = new Set(clipIds);
    return getAutomationLanes().some((lane) => lane.clipId !== undefined && clipIdSet.has(lane.clipId));
}

function hasClipSatelliteState(clipIds: readonly string[]): boolean {
    return hasEnvelopeOrWarpState(clipIds) || hasClipScopedAutomationLane(clipIds);
}

function serializedValuesEqual(left: string, right: string): boolean {
    try {
        const leftValue: unknown = JSON.parse(left);
        const rightValue: unknown = JSON.parse(right);
        return valuesEqual(leftValue, rightValue);
    } catch {
        return false;
    }
}

/**
 * A generation that itself writes satellites (a clip duplicate clones the
 * source's envelope and warp state) captures what it produced in
 * `clipSatellitesJson`; the guard then refuses only when the user moved those
 * satellites since. Clip-scoped automation lanes are captured the same way in
 * `clipAutomationLanesJson` — a separate field because the lanes live in
 * Automation's store, not the satellite pair. Either capture left absent keeps
 * that leg on the absence check, so a regeneration guard that captured nothing
 * still disqualifies on any satellite state at all.
 */
function clipSatelliteStateMatches(
    clipIds: readonly string[],
    guard: GeneratedMidiStateGuard,
    projected: ProjectedClipState | undefined
): boolean {
    if (guard.clipSatellitesJson === undefined && guard.clipAutomationLanesJson === undefined) {
        return !hasProjectedClipSatelliteState(clipIds, projected);
    }
    return (
        clipSatelliteEntriesMatch(clipIds, guard.clipSatellitesJson, projected) &&
        clipAutomationLanesMatch(clipIds, guard.clipAutomationLanesJson, projected)
    );
}

/**
 * Post-sibling satellite state for the clip: the entry a prior `restoreTrack`
 * re-establishes, or — when it re-establishes none — whatever the live stores
 * hold, because `writeClipSatelliteEntry` only runs for captured entries.
 */
function hasProjectedClipSatelliteState(
    clipIds: readonly string[],
    projected: ProjectedClipState | undefined
): boolean {
    const restoredEntry = projected?.restoredSatelliteEntry;
    if (restoredEntry !== null && restoredEntry !== undefined) {
        return true;
    }
    if (projected === undefined) {
        return hasClipSatelliteState(clipIds);
    }
    return hasEnvelopeOrWarpState(clipIds) || projected.clipScopedLanes.length > 0;
}

function clipSatelliteEntriesMatch(
    clipIds: readonly string[],
    captured: string | undefined,
    projected: ProjectedClipState | undefined
): boolean {
    const restoredEntry = projected?.restoredSatelliteEntry;
    if (restoredEntry !== null && restoredEntry !== undefined) {
        // The sibling overwrites the stores with exactly this entry, so the
        // projected comparison reads the entry, never the stale live state.
        // A capture-side entry always carries state, so an absence capture
        // can never match a sibling that re-establishes one.
        if (captured === undefined) {
            return false;
        }
        return serializeProjectedClipSatelliteEntries([restoredEntry], clipIds) === captured;
    }
    if (captured === undefined) {
        return !hasEnvelopeOrWarpState(clipIds);
    }
    return serializeClipSatelliteEntries(clipIds) === captured;
}

function clipAutomationLanesMatch(
    clipIds: readonly string[],
    captured: string | undefined,
    projected: ProjectedClipState | undefined
): boolean {
    if (projected === undefined) {
        if (captured === undefined) {
            return !hasClipScopedAutomationLane(clipIds);
        }
        return serializedValuesEqual(serializeClipScopedAutomationLanes(clipIds), captured);
    }
    const projectedSerialization = serializeProjectedClipScopedAutomationLanes(projected.clipScopedLanes);
    if (captured === undefined) {
        return projected.clipScopedLanes.length === 0;
    }
    return serializedValuesEqual(projectedSerialization, captured);
}

type GuardedEntity = {
    readonly entity: object;
    readonly clipIds: readonly string[];
};

/**
 * The guarded entity plus the clip ids its satellite/notes state hangs off. For
 * a clip the projected candidate from a prior restoreTrack sibling joins the
 * live matches, and the guard still demands exactly one holder of the id — a
 * live clip AND a sibling-restored one is external interference, not replay.
 */
function resolveGuardedEntity(
    state: NonNullable<ReturnType<typeof getTrackStoreState>>,
    entityId: string,
    entityType: 'clip' | 'track',
    projectedClipState: ProjectedClipState | undefined
): GuardedEntity | null {
    if (entityType === 'clip') {
        const liveMatches = state.tracks.flatMap((track) => track.clips.filter((clip) => clip.id === entityId));
        const projectedClip = projectedClipState?.locatedClip?.clip ?? null;
        const candidates = projectedClip ? [...liveMatches, projectedClip] : liveMatches;
        const [clip] = candidates;
        if (!clip || candidates.length !== 1) {
            return null;
        }
        return { entity: clip, clipIds: [entityId] };
    }
    const track = state.tracks.find((candidate) => candidate.id === entityId);
    if (!track) {
        return null;
    }
    return { entity: track, clipIds: collectTrackClipIds(track) };
}

/**
 * Whether the generated entity still carries exactly the state its generation
 * left behind.
 *
 * #3814: inside a grouped-undo replay preflight, a prior sibling's restore may
 * be what re-establishes the guarded state — a `removeTrack` member purges
 * every clip store its track held, and only the batch's own `restoreTrack`
 * inverse brings them back. The projected legs above read that sibling's
 * snapshot; the remaining legs below stay live because no sibling can move
 * them (see the linked-clip note).
 */
export function isGeneratedMidiStateCurrent({
    entityId,
    entityType,
    guard,
    allowedReferencingTrackIds = [],
    projectedMidiNotesByClipId,
    projectedClipState,
}: IsGeneratedMidiStateCurrentInput): boolean {
    const state = getTrackStoreState();
    if (!state) {
        return false;
    }
    const guarded = resolveGuardedEntity(state, entityId, entityType, projectedClipState);
    if (!guarded) {
        return false;
    }
    const { entity, clipIds } = guarded;

    if (!matchesJsonFingerprint(entity, guard.entityJson)) {
        return false;
    }
    if (
        !serializedValuesEqual(
            serializeMidiStateForClips(clipIds, projectedMidiNotesByClipId),
            guard.midiByClipIdJson
        ) ||
        !clipSatelliteStateMatches(clipIds, guard, projectedClipState)
    ) {
        return false;
    }

    const clipIdSet = new Set(clipIds);
    const linkedClipExists = state.tracks.some((track) =>
        track.clips.some((clip) => !clipIdSet.has(clip.id) && clip.parentClipId && clipIdSet.has(clip.parentClipId))
    );
    if (linkedClipExists) {
        return false;
    }
    if (entityType === 'clip') {
        return true;
    }

    const allowedReferences = new Set(allowedReferencingTrackIds);
    const referencedByTrack = state.tracks.some(
        (track) =>
            track.id !== entityId &&
            !allowedReferences.has(track.id) &&
            (track.parentId === entityId ||
                track.outputId === entityId ||
                track.midiOutputTrackId === entityId ||
                track.sends.some((send) => send.busId === entityId))
    );
    if (referencedByTrack) {
        return false;
    }
    // Track-scoped lanes (no clipId) are user-drawn state no generation
    // writes, so any one of them still disqualifies undo. Clip-scoped lanes
    // keyed to this track are governed by `clipAutomationLanesJson` above —
    // a track duplicate clones the source's lanes onto the copies' clip ids,
    // and the exact-match (or absence) leg there already refuses a lane the
    // generation did not leave behind.
    if (getAutomationLanes().some((lane) => lane.trackId === entityId && lane.clipId === undefined)) {
        return false;
    }
    if (takeLaneStore.value?.lanes.some((lane) => lane.trackId === entityId)) {
        return false;
    }
    if (getAllSidechainRoutes().some((route) => route.sourceTrackId === entityId || route.targetTrackId === entityId)) {
        return false;
    }
    return !modulationStore.value?.modulators.some(
        (modulator) =>
            modulator.trackId === entityId || modulator.mappings.some((mapping) => mapping.targetTrackId === entityId)
    );
}
