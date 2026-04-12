import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function removeClip(clipId: string): void {
    mapAllTracks((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
}
