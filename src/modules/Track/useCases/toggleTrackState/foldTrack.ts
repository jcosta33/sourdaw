import { updateTrack } from '#/modules/Track/repositories/trackRepository';

export function foldTrack(trackId: string, folded: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, collapsed: folded }));
}
