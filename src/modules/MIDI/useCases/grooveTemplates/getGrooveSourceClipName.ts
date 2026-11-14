import { trackStore } from '#/modules/Arrangement/stores';

/** The name the source clip shows, which an extracted template is named after; null when it has none. */
export function getGrooveSourceClipName(clipId: string): string | null {
    for (const track of trackStore.value?.tracks ?? []) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip !== undefined) {
            return clip.name.trim().length > 0 ? clip.name : null;
        }
    }
    return null;
}
