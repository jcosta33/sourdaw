import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';

export function hideTrack(trackId: string, hidden: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, hidden }));
}
