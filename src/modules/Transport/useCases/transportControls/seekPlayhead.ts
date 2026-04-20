import { stopAllScheduled, resetMidiState } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { startPlayheadScheduler, stopPlayheadScheduler } from '../playheadScheduler';

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
