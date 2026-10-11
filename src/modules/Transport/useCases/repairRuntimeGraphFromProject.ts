import { trackStore } from '#/modules/Arrangement/stores';
import { rearmInputMonitoring } from '#/modules/Arrangement/useCases';
import { resetAudioGraph, stopAllScheduled, suspendAutoInputMonitoring } from '#/modules/AudioEngine/useCases';
import { retractEveryCrumbsEngineAttachment } from '#/modules/Crumbs/useCases';
import { resetMidiState } from '#/modules/MIDI/useCases';
import { resetExternalPluginRuntimeForGraphRebuild } from '#/modules/PluginHost/useCases';

import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../stores/playheadPositionRef';

import { ensureTrackStrips } from './ensureTrackStrips';
import { startPlayheadScheduler } from './playheadScheduler/startPlayheadScheduler';
import { stopPlayheadScheduler } from './playheadScheduler/stopPlayheadScheduler';
import { panicYeastRuntime } from './transportControls/panicYeastRuntime';

async function rebuildRuntimeGraph(wasPlaying: boolean, resumePosition: number): Promise<void> {
    if (wasPlaying) {
        stopPlayheadScheduler();
        stopAllScheduled();
        resetMidiState();
        updateTransportState({ isPlaying: false, playheadPosition: resumePosition });
        playheadPositionRef.current = resumePosition;
        await panicYeastRuntime();
    }

    await resetExternalPluginRuntimeForGraphRebuild();
    // The repair does not release the engine: the reset above unloads the
    // hosted plugin runtime and nothing else, so every Crumbs instance the
    // engine holds stays attached across the rebuild. The mirror is emptied
    // here all the same. Nothing below refills it — the rebuild builds Web
    // Audio and sends no graph batch — so the next Play does, reporting the
    // instances it finds held and re-projecting the strips it binds.
    retractEveryCrumbsEngineAttachment();
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

    // The reset above released every monitor capture, so a track whose
    // persisted intent is 'on' must start its monitor again against the strip
    // the rebuild just produced. The shared law re-arms only 'on' tracks and
    // settles every start so an individual refusal cannot fail the repair.
    await rearmInputMonitoring(trackStore.value?.tracks ?? []);

    if (wasPlaying) {
        updateTransportState({ isPlaying: true, playheadPosition: resumePosition });
        playheadPositionRef.current = resumePosition;
        startPlayheadScheduler();
    }
}

/** Rebuilds runtime truth from the project while preserving one coherent transport state. */
export async function repairRuntimeGraphFromProject(): Promise<void> {
    const transport = getTransportState();
    if (!transport) {
        throw new Error('Runtime graph repair requires initialized transport state');
    }
    if (transport.isRecording) {
        throw new Error('Runtime graph repair is unavailable while recording');
    }
    const wasPlaying = transport.isPlaying;
    const resumePosition = wasPlaying ? playheadPositionRef.current : transport.playheadPosition;

    // A playing repair publishes a stopped transport while it rebuilds. Auto
    // monitoring reads every transport publication, so it would take that pause
    // for rest and open the microphone under a rolling transport. Holding the
    // owner keeps the transport state truthful for every other reader and lets
    // the owner settle once, against the state the repair leaves behind.
    const resumeAutoInputMonitoring = suspendAutoInputMonitoring();
    try {
        await rebuildRuntimeGraph(wasPlaying, resumePosition);
    } finally {
        resumeAutoInputMonitoring();
    }
}
