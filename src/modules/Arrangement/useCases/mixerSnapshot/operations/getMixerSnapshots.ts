import { type MixerSnapshot } from '#/modules/Arrangement/models/MixerSnapshotTypes';
import { mixerSnapshotStore } from './helpers';

/**
 * Get all saved mixer snapshots.
 */
export function getMixerSnapshots(): MixerSnapshot[] {
    return mixerSnapshotStore.value?.snapshots ?? [];
}