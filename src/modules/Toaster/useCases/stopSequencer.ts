import { toasterStore } from '../stores/toasterStore';

import { getSequencerPlaybackState } from './getSequencerPlaybackState';
import { releaseToasterNotes } from './releaseToasterNotes';

export function stopSequencer(deviceId: string): void {
    const seqState = getSequencerPlaybackState(deviceId);
    seqState.running = false;
    if (seqState.timeoutId !== null) {
        clearTimeout(seqState.timeoutId);
        seqState.timeoutId = null;
    }
    releaseToasterNotes(deviceId);
    seqState.preScheduledStep = null;
    const state = toasterStore.value?.[deviceId];
    if (state) {
        toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, isPlaying: false, currentStep: 0 } });
    }
    seqState.playCount = 0;
    seqState.lastBpm = null;
}
