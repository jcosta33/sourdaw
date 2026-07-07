import { getSequencerPlaybackState } from './getSequencerPlaybackState';

export function setFillActive(deviceId: string, active: boolean): void {
    getSequencerPlaybackState(deviceId).fillActive = active;
}
