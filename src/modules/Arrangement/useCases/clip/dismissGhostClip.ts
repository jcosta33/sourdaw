import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function dismissGhostClip(clipId: string): void {
    mapAllTracks((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
}
