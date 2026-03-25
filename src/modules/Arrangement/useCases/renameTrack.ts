import { updateTrack } from '../repositories/track';

export function renameTrack(trackId: string, name: string): void {
    updateTrack(trackId, (t) => ({ ...t, name }));
}
