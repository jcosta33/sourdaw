import { type Device } from '../../models/Track';
import { updateTrack } from '../../repositories/track/updateTrack';

/** Handler-private project write; public callers must compile and dispatch an AppAction. */
export function reorderDevicesInProject(trackId: string, deviceChain: readonly Device[]): void {
    const devices = [...deviceChain];
    updateTrack(trackId, (current) => ({ ...current, devices }));
}
