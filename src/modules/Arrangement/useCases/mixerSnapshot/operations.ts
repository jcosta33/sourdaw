import { createStore } from '#/infra/store/createStore';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { type MixerChannelSnapshot, type MixerSnapshot } from '#/modules/Arrangement/models/MixerSnapshotTypes';

type MixerSnapshotState = {
    snapshots: MixerSnapshot[];
};

export const mixerSnapshotStore = createStore<MixerSnapshotState>({
    initialData: { snapshots: [] },
});

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

export function recallMixerSnapshot(snapshotId: string): MixerChannelSnapshot[] | null {
    const snaps = mixerSnapshotStore.value?.snapshots ?? [];
    const snapshot = snaps.find((s) => s.id === snapshotId);
    if (!snapshot) {
        return null;
    }

    const state = getTrackState();
    if (!state) {
        return null;
    }

    const previousState: MixerChannelSnapshot[] = state.tracks.map((t) => ({
        trackId: t.id,
        gain: t.gain,
        pan: t.pan,
        muted: t.muted,
        soloed: t.soloed,
    }));

    const channelMap = new Map(snapshot.channels.map((c) => [c.trackId, c]));

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) => {
            const saved = channelMap.get(t.id);
            if (!saved) {
                return t;
            }
            return {
                ...t,
                gain: saved.gain,
                pan: saved.pan,
                muted: saved.muted,
                soloed: saved.soloed,
            };
        }),
    });

    return previousState;
}

export function restoreMixerChannels(channels: MixerChannelSnapshot[]): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const channelMap = new Map(channels.map((c) => [c.trackId, c]));

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) => {
            const saved = channelMap.get(t.id);
            if (!saved) {
                return t;
            }
            return {
                ...t,
                gain: saved.gain,
                pan: saved.pan,
                muted: saved.muted,
                soloed: saved.soloed,
            };
        }),
    });
}

/**
 * Get all saved mixer snapshots.
 */
export function getMixerSnapshots(): MixerSnapshot[] {
    return mixerSnapshotStore.value?.snapshots ?? [];
}

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
