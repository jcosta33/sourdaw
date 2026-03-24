import { updateTrack } from '../repositories/trackRepository';

export function renameTrack(trackId: string, name: string): void {
    updateTrack(trackId, (t) => ({ ...t, name }));
}
