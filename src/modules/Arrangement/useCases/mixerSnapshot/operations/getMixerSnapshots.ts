import { type MixerSnapshot } from '../../../models/MixerSnapshotTypes';
import { mixerSnapshotStore } from '../../../stores/mixerSnapshotStore';

/**
 * Get all saved mixer snapshots.
 */
export function getMixerSnapshots(): MixerSnapshot[] {
    return mixerSnapshotStore.value?.snapshots ?? [];
}
