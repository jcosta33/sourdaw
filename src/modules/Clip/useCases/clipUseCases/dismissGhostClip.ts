import { mapAllTracks } from '#/modules/Track/repositories/trackRepository';

export function dismissGhostClip(clipId: string): void {
    mapAllTracks((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
}
