import { trackStore } from '#/modules/Arrangement/stores';

import { type RecordedClipSpan } from './planRecordedControllers';

/** The clip with this id as the timeline holds it now, or `undefined` once it is gone. */
export function findLiveClip(clipId: string): RecordedClipSpan | undefined {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}
