import { modulationStore } from '#/modules/Automation/stores';
import { getAutomationLanes } from '#/modules/Automation/useCases';
import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { collectTrackClipIds } from '../services/collectTrackClipIds';
import { getEnvelope } from '../stores/gainEnvelopeStore';
import { takeLaneStore } from '../stores/takeLaneStore';
import { hasNonDefaultWarpState } from '../stores/warpStates';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

type IsGeneratedMidiStateCurrentInput = {
    entityId: string;
    entityType: 'clip' | 'track';
    guard: GeneratedMidiStateGuard;
    allowedReferencingTrackIds?: readonly string[];
};

function hasClipSatelliteState(clipIds: readonly string[]): boolean {
    const clipIdSet = new Set(clipIds);
    if (clipIds.some((clipId) => getEnvelope(clipId) !== undefined || hasNonDefaultWarpState(clipId))) {
        return true;
    }
    return getAutomationLanes().some((lane) => lane.clipId !== undefined && clipIdSet.has(lane.clipId));
}

export function isGeneratedMidiStateCurrent({
    entityId,
    entityType,
    guard,
    allowedReferencingTrackIds = [],
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

    if (JSON.stringify(entity) !== guard.entityJson) {
        return false;
    }
    if (serializeMidiStateForClips(clipIds) !== guard.midiByClipIdJson || hasClipSatelliteState(clipIds)) {
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
    if (getAutomationLanes().some((lane) => lane.trackId === entityId)) {
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
