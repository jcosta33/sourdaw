import { appendClipToTrack } from '../../stores/appendClipToTrack';
import { trackStore } from '../../stores/trackStore';
import { updateClipInStore } from '../../stores/updateClipInStore';

/**
 * Accept a ghost clip, making it a permanent part of the track (E1).
 */
export function acceptGhostClip(clipId: string): boolean {
    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const matchingGhosts = (state.ghostClips ?? []).filter((context) => context.id === clipId);
    if (matchingGhosts.length === 0) {
        return updateClipInStore(clipId, (clip) => ({ ...clip, isGhost: false }));
    }
    if (matchingGhosts.length !== 1) {
        return false;
    }

    const ghost = matchingGhosts[0];
    if (!ghost) {
        return false;
    }

    const ghostType: unknown = ghost.type;
    const hasValidIdentity = typeof ghost.id === 'string' && ghost.id.length > 0;
    const hasValidOwner = typeof ghost.trackId === 'string' && ghost.trackId.length > 0;
    const hasValidName = typeof ghost.name === 'string';
    const hasValidType = ghostType === 'audio' || ghostType === 'midi';
    const hasFiniteSpan = Number.isFinite(ghost.startBeat) && Number.isFinite(ghost.endBeat);
    const hasPositiveSpan = ghost.startBeat >= 0 && ghost.endBeat > ghost.startBeat;
    if (!hasValidIdentity || !hasValidOwner || !hasValidName || !hasValidType || !hasFiniteSpan || !hasPositiveSpan) {
        return false;
    }

    const { trackId, ...clipData } = ghost;
    const inserted = appendClipToTrack(trackId, { ...clipData, trackId, isGhost: false });
    if (!inserted) {
        return false;
    }

    const updated = trackStore.value;
    if (!updated) {
        return false;
    }
    trackStore.set({
        ...updated,
        ghostClips: (updated.ghostClips ?? []).filter((context) => context.id !== clipId),
    });
    return true;
}
