import { modulationStore } from '#/modules/Automation/stores';
import { getAutomationLanes } from '#/modules/Automation/useCases';
import { type projectMidiNotesByClipIdThroughRestores, serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { collectTrackClipIds } from '../services/collectTrackClipIds';
import { serializeClipSatelliteEntries } from '../stores/clipSatelliteState';
import { getEnvelope } from '../stores/gainEnvelopeStore';
import { takeLaneStore } from '../stores/takeLaneStore';
import { hasNonDefaultWarpState } from '../stores/warpStates';
import { serializeClipScopedAutomationLanes } from '../useCases/clip/serializeClipScopedAutomationLanes';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

import { isJsonEntityEqual } from './isJsonEntityEqual';

type IsGeneratedMidiStateCurrentInput = {
    entityId: string;
    entityType: 'clip' | 'track';
    guard: GeneratedMidiStateGuard;
    allowedReferencingTrackIds?: readonly string[];
    projectedMidiNotesByClipId?: ReturnType<typeof projectMidiNotesByClipIdThroughRestores>;
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
function clipSatelliteStateMatches(clipIds: readonly string[], guard: GeneratedMidiStateGuard): boolean {
    if (guard.clipSatellitesJson === undefined && guard.clipAutomationLanesJson === undefined) {
        return !hasClipSatelliteState(clipIds);
    }
    return (
        clipSatelliteEntriesMatch(clipIds, guard.clipSatellitesJson) &&
        clipAutomationLanesMatch(clipIds, guard.clipAutomationLanesJson)
    );
}

function clipSatelliteEntriesMatch(clipIds: readonly string[], captured: string | undefined): boolean {
    if (captured === undefined) {
        return !hasEnvelopeOrWarpState(clipIds);
    }
    return serializeClipSatelliteEntries(clipIds) === captured;
}

function clipAutomationLanesMatch(clipIds: readonly string[], captured: string | undefined): boolean {
    if (captured === undefined) {
        return !hasClipScopedAutomationLane(clipIds);
    }
    return serializeClipScopedAutomationLanes(clipIds) === captured;
}

export function isGeneratedMidiStateCurrent({
    entityId,
    entityType,
    guard,
    allowedReferencingTrackIds = [],
    projectedMidiNotesByClipId,
}: IsGeneratedMidiStateCurrentInput): boolean {
    const state = getTrackStoreState();
    if (!state) {
        return false;
    }

    let entity: object;
    let clipIds: string[];
    if (entityType === 'clip') {
        const matches = state.tracks.flatMap((track) => track.clips.filter((clip) => clip.id === entityId));
        const [clip] = matches;
        if (!clip || matches.length !== 1) {
            return false;
        }
        entity = clip;
        clipIds = [entityId];
    } else {
        const track = state.tracks.find((candidate) => candidate.id === entityId);
        if (!track) {
            return false;
        }
        entity = track;
        clipIds = collectTrackClipIds(track);
    }

    if (!isJsonEntityEqual(entity, guard.entityJson)) {
        return false;
    }
    if (
        serializeMidiStateForClips(clipIds, projectedMidiNotesByClipId) !== guard.midiByClipIdJson ||
        !clipSatelliteStateMatches(clipIds, guard)
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
