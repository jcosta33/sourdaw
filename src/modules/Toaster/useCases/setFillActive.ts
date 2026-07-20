import { getToasterDeviceControls } from '#/modules/AudioEngine/useCases';

import { getSequencerPlaybackState } from './getSequencerPlaybackState';

export function setFillActive(deviceId: string, active: boolean): void {
    const state = getSequencerPlaybackState(deviceId);
    state.fillActive = active;
    getToasterDeviceControls(deviceId)?.setFillActive(active);
}
