import { trackStore } from '#/modules/Arrangement/stores';

/** Every clip on the timeline right now. */
export function readLiveClipIds(): Set<string> {
    return new Set(trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
}
