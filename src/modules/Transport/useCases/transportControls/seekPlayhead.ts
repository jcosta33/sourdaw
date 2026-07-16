import { logger } from '#/infra/logger/appLogger';
import { stopAllScheduled, resetMidiState } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { startPlayheadScheduler, stopPlayheadScheduler } from '../playheadScheduler';

import { panicYeastRuntime } from './panicYeastRuntime';
import { stopActiveRecording } from './stopActiveRecording';

export function seekPlayhead(beat: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    const wasPlaying = state.isPlaying;
    const wasRecording = state.isRecording;
    const targetBeat = Math.max(0, beat);

    function finishSeek(): void {
        panicYeastRuntime();
        if (wasPlaying) {
            stopPlayheadScheduler();
            stopAllScheduled();
            resetMidiState();
        }

        updateTransportState({ playheadPosition: targetBeat });
        playheadPositionRef.current = targetBeat;

        // Resume only playback after a seek. We deliberately do not re-arm
        // recording here: `stopPlayheadScheduler` already flushed the recorded
        // automation segment up to the seek point (via `stopAutomationRecording`),
        // and re-starting the scheduler re-arms a fresh automation session for the
        // remainder. Recording stays committed/closed so the lane is split at the
        // seek rather than re-armed on every jump.
        if (wasPlaying) {
            startPlayheadScheduler();
        }
    }

    // Commit any in-progress recording before moving the playhead. The audio
    // recorder and clip pipeline must flush while the engine is still live, so
    // the seek teardown waits for the flush (mirrors `stopPlayback`). Without
    // this, seeking mid-take left the media recorder capturing and the recorded
    // buffer never landed in its clip.
    if (!wasRecording) {
        finishSeek();
        return;
    }

    Promise.resolve(stopActiveRecording())
        .catch((error: unknown) => {
            logger.error(new Error('Recording teardown failed before seeking the playhead', { cause: error }));
        })
        .then(finishSeek)
        .catch((error: unknown) => {
            logger.error(new Error('Playhead seek cleanup failed', { cause: error }));
        });
}
