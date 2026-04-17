import { activeFreezeTasks } from './freezeTrack';

export function cancelFreezeTrack(trackId: string): void {
    if (activeFreezeTasks.has(trackId)) {
        activeFreezeTasks.get(trackId)!.abort();
        activeFreezeTasks.delete(trackId);
    }
}
