import { notifyUser } from '#/utils/Notification/notifyUser';

import { trackStore } from '../../stores/trackStore';

const FROZEN_TRACK_NOTE_EDIT_MESSAGE = 'This track is frozen. Unfreeze it to edit its notes.';

function isClipOnFrozenTrack(clipId: string): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    return tracks.some((track) => track.frozen === true && track.clips.some((clip) => clip.id === clipId));
}

/**
 * A frozen track keeps playing its frozen buffer, so a note edit would be silent
 * and the freeze would never go stale. Matches the action-route guard
 * `getWritableMidiClipReplayGuard`. Returns true when the edit must not run
 * and has warned the user.
 */
export function refuseInlineMidiEditOnFrozenTrack(clipId: string): boolean {
    if (!isClipOnFrozenTrack(clipId)) {
        return false;
    }
    notifyUser(FROZEN_TRACK_NOTE_EDIT_MESSAGE, 'warning');
    return true;
}
