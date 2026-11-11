import { trackStore, type Clip } from '#/modules/Arrangement/stores';

import { getSelectedClipId } from './getSelectedClipId';

export function getSelectedClipIdOfType(type: Clip['type']): string | null {
    const clipId = getSelectedClipId();
    if (!clipId) {
        return null;
    }
    const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    return clip?.type === type ? clip.id : null;
}
