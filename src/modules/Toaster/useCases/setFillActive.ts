import { cancelScheduledToasterHits } from './cancelScheduledToasterHits';
import { getSequencerPlaybackState } from './getSequencerPlaybackState';

export function setFillActive(deviceId: string, active: boolean): void {
    const state = getSequencerPlaybackState(deviceId);
    state.fillActive = active;
    state.preScheduledStep = null;
    cancelScheduledToasterHits(deviceId);
}
