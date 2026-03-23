import { updateTrack } from '#/modules/Track/repositories/trackRepository';

export function hideTrack(trackId: string, hidden: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, hidden }));
}
