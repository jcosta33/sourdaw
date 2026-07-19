import { getAudioTime } from '#/modules/AudioEngine/useCases';

import { getSequencerPlaybackState } from './getSequencerPlaybackState';
import { runSequencerTick } from './sequencerPlayback';
import { stopSequencer } from './stopSequencer';

export function startSequencer(deviceId: string, bpm: number): void {
    stopSequencer(deviceId);
    const seqState = getSequencerPlaybackState(deviceId);
    seqState.running = true;
    seqState.playCount = 0;
    seqState.lastBpm = null;
    seqState.nextTickTime = getAudioTime();
    runSequencerTick({ deviceId, currentStep: 0, bpm });
}
