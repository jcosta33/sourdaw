import { type Track } from '../../models/Track';
import { updateTrack } from '../../repositories/track/updateTrack';

/** Handler-private project write; public callers must compile and dispatch an AppAction. */
export function reorderDevicesInProject(trackId: string, after: Track): void {
    updateTrack(trackId, () => after);
}
