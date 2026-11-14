import { type AppAction } from '#/utils/handlerContract';

import { type Clip, sanitizeTrackSnapshot } from '../../stores/trackStore';
import { buildDuplicateClipInput } from '../clip/buildDuplicateClipInput';
import { isClipDropCompatible } from '../clip/isClipDropCompatible';
import { getTrackStoreState } from '../getTrackStoreState';

import { insertRestoredClips } from './insertRestoredClips';
import { type ShiftedOwnerState } from './ShiftedOwnerState';

export function projectDuplicate(
    action: Extract<AppAction, { type: 'duplicateClipAt' }>,
    state: ShiftedOwnerState
): ShiftedOwnerState | null {
    const payload = action.payload;
    const tracks = getTrackStoreState()?.tracks ?? [];
    const source = state.clips.find((owner) => owner.clip.id === payload.clipId);
    const sourceTrack = tracks.find((track) => track.id === source?.owningTrackId);
    const destination = tracks.find((track) => track.id === payload.destinationTrackId);
    const targetClipId = payload.targetClipId;
    if (
        !source ||
        !sourceTrack ||
        !destination ||
        !targetClipId ||
        state.clips.some((owner) => owner.clip.id === targetClipId)
    ) {
        return null;
    }
    const clip = sanitizeTrackSnapshot({ tracks: [{ ...sourceTrack, clips: [source.clip] }] }).tracks[0]?.clips[0];
    if (!clip || !isClipDropCompatible(clip.type, destination.kind)) {
        return null;
    }
    const copy: Clip = {
        ...buildDuplicateClipInput(clip, {
            targetClipId,
            destinationTrackId: destination.id,
            startBeat: payload.startBeat,
        }),
        // addClip includes this unset optional in its newly produced runtime value.
        isGhost: undefined,
    };
    if (
        !Number.isFinite(copy.startBeat) ||
        !Number.isFinite(copy.endBeat) ||
        copy.startBeat < 0 ||
        copy.endBeat <= copy.startBeat
    ) {
        return null;
    }
    return {
        ...state,
        clips: insertRestoredClips(
            state.clips,
            destination.id,
            undefined,
            [copy],
            tracks.map((track) => track.id)
        ),
    };
}
