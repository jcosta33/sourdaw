import { getAutomationLanes } from '#/modules/Automation/useCases';
import { hasActiveStepRecordingDependency } from '#/modules/MIDI/useCases';

import { getEnvelope } from '../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { hasNonDefaultWarpState } from '../../stores/warpStates';
import { getTrackStoreState } from '../getTrackStoreState';

export function hasClipGlueDependencies(clipIds: readonly string[]): boolean {
    const clipIdSet = new Set(clipIds);
    if (hasActiveStepRecordingDependency(clipIds)) {
        return true;
    }
    if (clipIds.some((clipId) => getEnvelope(clipId) !== undefined || hasNonDefaultWarpState(clipId))) {
        return true;
    }
    if (getAutomationLanes().some((lane) => lane.clipId !== undefined && clipIdSet.has(lane.clipId))) {
        return true;
    }
    const hasTakeLaneDependency = (takeLaneStore.value?.lanes ?? []).some((lane) =>
        lane.takes.some((take) => clipIdSet.has(take.clipId))
    );
    if (hasTakeLaneDependency) {
        return true;
    }
    const state = getTrackStoreState();
    function hasExternalLinkedChild(clip: { id: string; parentClipId?: string }): boolean {
        return !clipIdSet.has(clip.id) && clip.parentClipId !== undefined && clipIdSet.has(clip.parentClipId);
    }
    return (
        (state?.ghostClips ?? []).some(hasExternalLinkedChild) ||
        (state?.tracks.some(
            (track) =>
                track.clips.some(hasExternalLinkedChild) ||
                track.alternatives.some((alternative) => alternative.clips.some(hasExternalLinkedChild))
        ) ??
            false)
    );
}
