import { getTrackState } from '../../../repositories/track/getTrackState';
import { setTrackState } from '../../../repositories/track/setTrackState';
import { type MixerChannelSnapshot } from '../../../models/MixerSnapshotTypes';
import { mixerSnapshotStore } from './helpers';

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