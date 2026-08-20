import { hasActiveStepRecordingDependency } from '#/modules/MIDI/useCases';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { getTrackStoreState } from '../getTrackStoreState';

/**
 * Dependencies that still make gluing unsafe to attempt at all: an active
 * step-recording session, a take lane, or a clip linked to a source.
 *
 * A source clip's gain envelope, warp state, and clip-scoped automation lanes
 * are deliberately NOT checked here — `prepareClipGlue`/`restoreClipGlueState`
 * migrate the first source's envelope and warp state onto the glued clip and
 * retire the rest undoably (ledger #2108), so their presence no longer blocks
 * the glue.
 */
export function hasClipGlueDependencies(clipIds: readonly string[]): boolean {
    const clipIdSet = new Set(clipIds);
    if (hasActiveStepRecordingDependency(clipIds)) {
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
