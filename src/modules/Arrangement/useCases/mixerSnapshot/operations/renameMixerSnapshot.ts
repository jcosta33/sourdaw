import { mixerSnapshotStore } from '../../../stores/mixerSnapshotStore';

/**
 * Rename a mixer snapshot.
 */
export function renameMixerSnapshot(snapshotId: string, name: string): void {
    const current = mixerSnapshotStore.value;
    if (!current) {
        return;
    }
    mixerSnapshotStore.set({
        snapshots: current.snapshots.map((state) => (state.id === snapshotId ? { ...state, name } : state)),
    });
}
