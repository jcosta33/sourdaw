import { mixerSnapshotStore } from './helpers';

/**
 * Rename a mixer snapshot.
 */
export function renameMixerSnapshot(snapshotId: string, name: string): void {
    const current = mixerSnapshotStore.value;
    if (!current) {
        return;
    }
    mixerSnapshotStore.set({
        snapshots: current.snapshots.map((s) => (s.id === snapshotId ? { ...s, name } : s)),
    });
}
