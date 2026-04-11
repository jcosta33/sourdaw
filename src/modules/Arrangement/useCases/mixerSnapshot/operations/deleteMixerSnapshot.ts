import { mixerSnapshotStore } from './helpers';

/**
 * Delete a mixer snapshot by ID.
 */
export function deleteMixerSnapshot(snapshotId: string): void {
    const current = mixerSnapshotStore.value;
    if (!current) {
        return;
    }
    mixerSnapshotStore.set({ snapshots: current.snapshots.filter((s) => s.id !== snapshotId) });
}