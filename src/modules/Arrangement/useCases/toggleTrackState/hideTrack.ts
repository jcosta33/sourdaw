import { updateTrack } from '#/modules/Arrangement/repositories/trackRepository';

export function hideTrack(trackId: string, hidden: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, hidden }));
}
