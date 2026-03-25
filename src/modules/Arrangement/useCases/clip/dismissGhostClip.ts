import { mapAllTracks } from '#/modules/Arrangement/repositories/track';

export function dismissGhostClip(clipId: string): void {
    mapAllTracks((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
}
