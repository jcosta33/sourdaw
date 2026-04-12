import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function acceptGhostClip(clipId: string): void {
    mapAllTracks((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, isGhost: undefined } : c)),
    }));
}
