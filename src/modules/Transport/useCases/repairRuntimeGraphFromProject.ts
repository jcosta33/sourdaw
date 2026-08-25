import { resetAudioGraph, stopAllScheduled } from '#/modules/AudioEngine/useCases';
import { resetMidiState } from '#/modules/MIDI/useCases';

import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../stores/playheadPositionRef';

import { ensureTrackStrips } from './ensureTrackStrips';
import { startPlayheadScheduler } from './playheadScheduler/startPlayheadScheduler';
import { stopPlayheadScheduler } from './playheadScheduler/stopPlayheadScheduler';
import { panicYeastRuntime } from './transportControls/panicYeastRuntime';

/** Rebuilds runtime truth from the project while preserving one coherent transport state. */
export async function repairRuntimeGraphFromProject(): Promise<void> {
    const transport = getTransportState();
    if (transport?.isRecording) {
        throw new Error('Runtime graph repair is unavailable while recording');
    }
    const wasPlaying = transport?.isPlaying === true;
    const resumePosition = wasPlaying ? playheadPositionRef.current : transport?.playheadPosition;
    if (wasPlaying) {
        stopPlayheadScheduler();
        stopAllScheduled();
        resetMidiState();
        updateTransportState({ isPlaying: false, playheadPosition: resumePosition });
        playheadPositionRef.current = resumePosition;
        await panicYeastRuntime();
    }

    resetAudioGraph();
    const rebuild = ensureTrackStrips({ collectExternalPluginActivations: true });
    if (rebuild.status === 'failed') {
        throw new Error(`Runtime graph repair failed: ${rebuild.reason}`);
    }
    const pluginOutcomes = await Promise.all(rebuild.externalPluginActivations);
    const pluginFailures = pluginOutcomes.filter(
        (outcome): outcome is { status: 'failed'; reason: string } => outcome.status === 'failed'
    );
    if (pluginFailures.length > 0) {
        throw new Error(`Runtime graph repair failed: ${pluginFailures.map(({ reason }) => reason).join('; ')}`);
    }

    if (wasPlaying) {
        updateTransportState({ isPlaying: true, playheadPosition: resumePosition });
        playheadPositionRef.current = resumePosition;
        startPlayheadScheduler();
    }
}
