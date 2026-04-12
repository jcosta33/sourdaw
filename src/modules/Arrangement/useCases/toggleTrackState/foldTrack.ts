import { updateTrack } from '../../repositories/track/updateTrack';

export function foldTrack(trackId: string, folded: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, collapsed: folded }));
}
