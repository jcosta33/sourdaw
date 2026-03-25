import { updateTrack } from '#/modules/Arrangement/repositories/track';

export function hideTrack(trackId: string, hidden: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, hidden }));
}
