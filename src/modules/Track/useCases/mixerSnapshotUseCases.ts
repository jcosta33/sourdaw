/**
 * Mixer snapshot use cases.
 * Save, recall, and manage mixer state snapshots for A/B comparison and scene recall.
 *
 * Store access via trackStore (for gain/pan/mute/solo).
 */

import { getTrackState, setTrackState } from '../repositories/trackRepository';

export type MixerChannelSnapshot = {
    trackId: string;
    gain: number;
    pan: number;
    muted: boolean;
    soloed: boolean;
};

export type MixerSnapshot = {
    id: string;
    name: string;
    createdAt: number;
    channels: MixerChannelSnapshot[];
};

let snapshots: MixerSnapshot[] = [];

/**
 * Capture the current mixer state as a named snapshot.
 */
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

    snapshots = [...snapshots, snapshot];
    return snapshot;
}

/**
 * Recall a snapshot — applies its mixer settings to all matching tracks.
 * Tracks that no longer exist are silently skipped.
 * Returns the previous state for undo support.
 */
export function recallMixerSnapshot(snapshotId: string): MixerChannelSnapshot[] | null {
    const snapshot = snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
        return null;
    }

    const state = getTrackState();
    if (!state) {
        return null;
    }

    // Capture current state for undo
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

/**
 * Restore a previous mixer state (undo helper).
 */
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
    return snapshots;
}

/**
 * Delete a mixer snapshot by ID.
 */
export function deleteMixerSnapshot(snapshotId: string): void {
    snapshots = snapshots.filter((s) => s.id !== snapshotId);
}

/**
 * Rename a mixer snapshot.
 */
export function renameMixerSnapshot(snapshotId: string, name: string): void {
    snapshots = snapshots.map((s) => (s.id === snapshotId ? { ...s, name } : s));
}
