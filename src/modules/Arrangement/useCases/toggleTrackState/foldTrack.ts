import { updateTrack } from '#/modules/Arrangement/repositories/trackRepository';

export function foldTrack(trackId: string, folded: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, collapsed: folded }));
}
