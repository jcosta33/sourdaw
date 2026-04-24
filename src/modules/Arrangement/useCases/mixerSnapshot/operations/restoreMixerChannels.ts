import { type MixerChannelSnapshot } from '../../../models/MixerSnapshotTypes';
import { getTrackState } from '../../../repositories/track/getTrackState';
import { setTrackState } from '../../../repositories/track/setTrackState';

export function restoreMixerChannels(channels: MixerChannelSnapshot[]): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const channelMap = new Map(channels.map((context) => [context.trackId, context]));

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
}
