import { type MixerChannelSnapshot } from '../../../models/MixerSnapshotTypes';
import { getTrackState } from '../../../repositories/track/getTrackState';
import { setTrackState } from '../../../repositories/track/setTrackState';
import { mixerSnapshotStore } from '../../../stores/mixerSnapshotStore';

export function recallMixerSnapshot(snapshotId: string): MixerChannelSnapshot[] | null {
    const snaps = mixerSnapshotStore.value?.snapshots ?? [];
    const snapshot = snaps.find((state1) => state1.id === snapshotId);
    if (!snapshot) {
        return null;
    }

    const state = getTrackState();
    if (!state) {
        return null;
    }

    const previousState: MixerChannelSnapshot[] = state.tracks.map((time) => ({
        trackId: time.id,
        gain: time.gain,
        pan: time.pan,
        muted: time.muted,
        soloed: time.soloed,
    }));

    const channelMap = new Map(snapshot.channels.map((context) => [context.trackId, context]));

    setTrackState({
        ...state,
        tracks: state.tracks.map((time) => {
            const saved = channelMap.get(time.id);
            if (!saved) {
                return time;
            }
            return {
                ...time,
                gain: saved.gain,
                pan: saved.pan,
                muted: saved.muted,
                soloed: saved.soloed,
            };
        }),
    });

    return previousState;
}
