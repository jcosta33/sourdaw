import { type AppAction } from '#/utils/handlerContract';

import { type ClipStateSnapshot } from '../../events/arrangementClipStateSnapshots';
import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';

import { capturedClip } from './capturedClip';
import { resolveClipSplitInsertionIndex } from './resolveClipSplitInsertionIndex';
import { type LocatedClip, type ShiftedOwnerState } from './ShiftedOwnerState';

export function projectSplitRestore(
    state: ShiftedOwnerState,
    payload: Extract<AppAction, { type: 'restoreClipSplitState' }>['payload']
): ShiftedOwnerState | null {
    const { clipId, rightClipId, replacement } = payload;
    const trackClips = state.clips
        .filter((owner) => owner.owningTrackId === replacement.trackId && owner.clip.id !== rightClipId)
        .map((owner) => (owner.clip.id === clipId ? { ...owner, clip: replacement.leftClip } : owner));
    if (replacement.rightClip) {
        const index = resolveClipSplitInsertionIndex(
            trackClips.map((owner) => owner.clip),
            clipId,
            rightClipId,
            payload.expected,
            replacement
        );
        if (index === null) {
            return null;
        }
        trackClips.splice(index, 0, {
            owningTrackId: replacement.trackId,
            clip: replacement.rightClip,
        });
    }
    const firstIndex = state.clips.findIndex((owner) => owner.owningTrackId === replacement.trackId);
    const otherClips = state.clips.filter((owner) => owner.owningTrackId !== replacement.trackId);
    otherClips.splice(Math.max(0, firstIndex), 0, ...trackClips);
    let lanes = state.lanes;
    if (replacement.clipAutomationLanes !== undefined) {
        lanes = [...state.lanes.filter((lane) => lane.clipId !== rightClipId), ...replacement.clipAutomationLanes];
    }
    let tracks: ShiftedOwnerState['tracks'] = null;
    if (
        state.tracks &&
        trackClips.every((owner): owner is LocatedClip & { clip: ClipStateSnapshot } =>
            isExactClipSnapshot(owner.clip, owner.clip.id, replacement.trackId)
        )
    ) {
        tracks = state.tracks.map((track) => {
            if (track.id !== replacement.trackId) {
                return track;
            }
            return { ...track, clips: trackClips.map((owner) => capturedClip(owner.clip)) };
        });
    }
    return { ...state, clips: otherClips, lanes, tracks };
}
