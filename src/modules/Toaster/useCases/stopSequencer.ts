import { toasterStore } from '../stores/toasterStore';

import { getSequencerPlaybackState } from './getSequencerPlaybackState';

export function stopSequencer(deviceId: string): void {
    const seqState = getSequencerPlaybackState(deviceId);
    seqState.running = false;
    if (seqState.timeoutId !== null) {
        clearTimeout(seqState.timeoutId);
        seqState.timeoutId = null;
    }
    // Cancel any microtiming/retrigger fires already scheduled by the last
    // tick so no ghost hit lands after Stop.
    for (const id of seqState.pendingFireIds) {
        clearTimeout(id);
    }
    seqState.pendingFireIds.clear();
    seqState.preScheduledStep = null;
    const state = toasterStore.value?.[deviceId];
    if (state) {
        toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, isPlaying: false, currentStep: 0 } });
    }
    seqState.playCount = 0;
    seqState.lastBpm = null;
}
