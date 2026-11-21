import { notifyUser } from '#/utils/Notification/notifyUser';

import { trackStore } from '../../stores/trackStore';

const FROZEN_TRACK_NOTE_EDIT_MESSAGE = 'This track is frozen. Unfreeze it to edit its notes.';
const LOCKED_CLIP_NOTE_EDIT_MESSAGE = 'This clip is locked. Unlock it to edit its notes.';

function isClipOnFrozenTrack(clipId: string): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    return tracks.some((track) => track.frozen === true && track.clips.some((clip) => clip.id === clipId));
}

function isClipLocked(clipId: string): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    return tracks.some((track) => track.clips.some((clip) => clip.id === clipId && clip.locked === true));
}

/**
 * A frozen track keeps playing its frozen buffer, so a note edit would be silent
 * and the freeze would never go stale; a locked clip refuses every edit. Matches
 * the action-route guard `getWritableMidiClipReplayGuard`. Returns true when the
 * edit must not run and has warned the user.
 */
export function refuseInlineMidiEditOnFrozenTrack(clipId: string): boolean {
    if (isClipOnFrozenTrack(clipId)) {
        notifyUser(FROZEN_TRACK_NOTE_EDIT_MESSAGE, 'warning');
        return true;
    }
    if (isClipLocked(clipId)) {
        notifyUser(LOCKED_CLIP_NOTE_EDIT_MESSAGE, 'warning');
        return true;
    }
    return false;
}
