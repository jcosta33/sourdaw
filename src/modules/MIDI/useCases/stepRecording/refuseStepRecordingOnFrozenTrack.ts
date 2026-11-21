import { trackStore } from '#/modules/Arrangement/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

/**
 * A frozen track plays its rendered buffer and freeze staleness leaves note
 * content out, so a step-entered note there would change nothing audible.
 * Refuses (warns once, returns true) when the clip sits on a frozen track, so
 * the caller neither enables step input for it nor writes a note into it. The
 * track may freeze after step input was enabled, so the write path asks too.
 */
export function refuseStepRecordingOnFrozenTrack(clipId: string | null): boolean {
    if (clipId === null) {
        return false;
    }
    const tracks = trackStore.value?.tracks ?? [];
    if (!tracks.some((track) => track.frozen === true && track.clips.some((clip) => clip.id === clipId))) {
        return false;
    }
    notifyUser('This track is frozen. Unfreeze it to edit its notes.', 'warning');
    return true;
}
