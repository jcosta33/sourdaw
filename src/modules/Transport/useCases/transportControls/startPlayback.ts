import { resumeEngine } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { ensureTrackStrips } from '../ensureTrackStrips';
import { startPlayheadScheduler } from '../playheadScheduler';

export function startPlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    resumeEngine();
    ensureTrackStrips();

    let startPosition = state.playheadPosition;
    if (state.preRollEnabled && state.preRollBars > 0) {
        const preRollBeats = state.preRollBars * state.timeSignatureNumerator;
        startPosition = Math.max(0, startPosition - preRollBeats);
    }

    updateTransportState({ isPlaying: true, playheadPosition: startPosition });
    playheadPositionRef.current = startPosition;
    startPlayheadScheduler();
}
