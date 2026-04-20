import { type MixerChannelSnapshot } from '../../../models/MixerSnapshotTypes';
import { getTrackState } from '../../../repositories/track/getTrackState';
import { setTrackState } from '../../../repositories/track/setTrackState';

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
