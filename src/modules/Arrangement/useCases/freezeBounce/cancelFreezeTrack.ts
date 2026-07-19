import { freezeTaskAuthority } from './freezeTaskAuthority';

export function cancelFreezeTrack(trackId: string): void {
    if (freezeTaskAuthority.activeTasks.has(trackId)) {
        freezeTaskAuthority.activeTasks.get(trackId)!.abort();
    }
}
