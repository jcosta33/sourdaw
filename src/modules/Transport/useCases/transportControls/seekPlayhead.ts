import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transportRepository';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { startPlayheadScheduler, stopPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput';

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
