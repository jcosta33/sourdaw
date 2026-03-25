import { updateTrack } from '#/modules/Arrangement/repositories/track';

export function foldTrack(trackId: string, folded: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, collapsed: folded }));
}
