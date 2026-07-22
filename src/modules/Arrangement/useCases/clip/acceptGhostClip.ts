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

    const ghost = (state.ghostClips ?? []).find((context) => context.id === clipId);
    if (!ghost) {
        return updateClipInStore(clipId, (clip) => ({ ...clip, isGhost: false }));
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
