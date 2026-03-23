import { mapAllTracks } from '#/modules/Track/repositories/trackRepository';

export function acceptGhostClip(clipId: string): void {
    mapAllTracks((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, isGhost: undefined } : c)),
    }));
}
