import { getTrackState } from '../../../repositories/track/getTrackState';
import { type MixerSnapshot } from '../../../models/MixerSnapshotTypes';
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
        channels: state.tracks.map((t) => ({
            trackId: t.id,
            gain: t.gain,
            pan: t.pan,
            muted: t.muted,
            soloed: t.soloed,
        })),
    };

    const current = mixerSnapshotStore.value;
    if (!current) {
        return snapshot;
    }
    mixerSnapshotStore.set({ snapshots: [...current.snapshots, snapshot] });
    return snapshot;
}