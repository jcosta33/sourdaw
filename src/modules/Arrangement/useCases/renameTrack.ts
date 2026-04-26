import { updateTrack } from '../repositories/track/updateTrack';

export function renameTrack(trackId: string, name: string): void {
    updateTrack(trackId, (time) => ({ ...time, name }));
}
