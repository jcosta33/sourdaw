import { updateTrack } from '#/modules/Arrangement/repositories/trackRepository';

export function setTrackHeight(trackId: string, height: number): void {
    updateTrack(trackId, (t) => ({ ...t, height: Math.max(30, Math.min(300, height)) }));
}
