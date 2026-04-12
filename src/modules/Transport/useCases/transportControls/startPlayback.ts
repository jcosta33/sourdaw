
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { resumeEngine } from '#/modules/AudioEngine/useCases';
import { startPlayheadScheduler } from '../playheadScheduler';
import { ensureTrackStrips } from '../ensureTrackStrips';

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
