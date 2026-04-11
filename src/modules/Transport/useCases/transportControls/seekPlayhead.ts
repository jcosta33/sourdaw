import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { startPlayheadScheduler, stopPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { stopAllScheduled, resetMidiState } from '#/modules/AudioEngine/useCases';

export function seekPlayhead(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    const wasPlaying = state.isPlaying;
    const targetBeat = Math.max(0, beat);

    if (wasPlaying) {
        stopPlayheadScheduler();
        stopAllScheduled();
        resetMidiState();
    }

    updateTransportState({ playheadPosition: targetBeat });
    playheadPositionRef.current = targetBeat;

    if (wasPlaying) {
        startPlayheadScheduler();
    }
}
