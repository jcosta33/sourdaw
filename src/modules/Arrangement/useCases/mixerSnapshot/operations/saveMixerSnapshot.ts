import { type MixerSnapshot } from '../../../models/MixerSnapshotTypes';
import { getTrackState } from '../../../repositories/track/getTrackState';

import { mixerSnapshotStore } from './helpers';

export function saveMixerSnapshot(name: string): MixerSnapshot | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    const snapshot: MixerSnapshot = {
        id: `snap-${crypto.randomUUID().slice(0, 8)}`,
        name,
        createdAt: Date.now(),
        channels: state.tracks.map((time) => ({
            trackId: time.id,
            gain: time.gain,
            pan: time.pan,
            muted: time.muted,
            soloed: time.soloed,
        })),
    };

    const current = mixerSnapshotStore.value;
    if (!current) {
        return snapshot;
    }
    mixerSnapshotStore.set({ snapshots: [...current.snapshots, snapshot] });
    return snapshot;
}
