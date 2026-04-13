import { type OfflineBusStrip } from './types';

export function createOfflineBusStrip(
    offlineCtx: OfflineAudioContext,
    trackGain: number,
    masterGain: GainNode
): OfflineBusStrip {
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(2, trackGain));
    gainNode.connect(masterGain);
    return { gainNode };
}
