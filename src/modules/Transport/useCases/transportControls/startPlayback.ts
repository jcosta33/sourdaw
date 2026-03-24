import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transportRepository';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { resumeEngine } from '#/modules/AudioEngine/useCases/engineAccess';
import { startPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { ensureTrackStrips } from '#/modules/Transport/useCases/ensureTrackStrips';

export function startPlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    void resumeEngine();
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
