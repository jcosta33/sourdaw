import { trackStore, takeLaneStore } from '#/modules/Arrangement/stores';
import { startRecording, stopRecording, addTakeLane, addTake, updateClip } from '#/modules/Arrangement/useCases';
import {
    stopAllScheduled,
    startAudioRecording,
    stopAudioRecording,
    getAudioContext,
    audioEngine,
    scheduleAdjustmentLayers,
    cacheAudioBuffer,
} from '#/modules/AudioEngine/useCases';
import { startAutomationRecording, applyModulation, applyModulationToEngine } from '#/modules/Automation/useCases';

import { getTempoAtBeat } from '../models/TempoMap';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore } from '../stores/tempoMapStore';
import { transportStore } from '../stores/transportStore';

import { disposePlayheadScheduler } from './disposePlayheadScheduler';
import { evaluateFollowActions } from './evaluateFollowActions';
import { loopSignatureOf } from './loopSignatureOf';
import { MAX_DELTA_SECONDS, SCHEDULE_AHEAD_SECONDS, schedulerSession } from './playheadScheduler';
import { applyAutomation } from './scheduling/applyAutomation/applyAutomation';
import { applyVcaGains } from './scheduling/applyAutomation/applyVcaGains';
import { resetMetronomeBeat } from './scheduling/resetMetronomeBeat';
import { scheduleAudioClips } from './scheduling/scheduleAudioClips';
import { scheduleMetronome } from './scheduling/scheduleMetronome';
import { scheduleMidiNotes, type SchedulerCancellation } from './scheduling/scheduleMidiNotes';
import { stopActiveSources } from './stopActiveSources';

export function startPlayheadScheduler(): void {
    const state = transportStore.value;
    if (!state) {
        return;
    }

    schedulerSession.generation += 1;
    const schedulerGeneration = schedulerSession.generation;
    const cancellation: SchedulerCancellation = {
        generation: schedulerGeneration,
        isCurrent: () =>
            schedulerSession.generation === schedulerGeneration && transportStore.value?.isPlaying === true,
    };

    startAutomationRecording();

    const ctx = getAudioContext();
    schedulerSession.lastTickTime = ctx.currentTime;
    schedulerSession.accumulatedPosition = state.playheadPosition;
    playheadPositionRef.current = state.playheadPosition;
    schedulerSession.lastScheduledBeat = state.playheadPosition - 0.0001;
    schedulerSession.lastTempoMapChanges = tempoMapStore.value?.changes ?? null;
    schedulerSession.lastLoopSignature = loopSignatureOf(state);
    resetMetronomeBeat(state.playheadPosition);

    const grainMs = state.scheduleGrainMs;

    async function tick(): Promise<void> {
        // A prior tick is still awaiting its scheduling work (the Yeast Worker
        // round-trip in particular). Starting now would let two ticks mutate the
        // shared session mutables across one another's awaits. Skip this worker
        // tick; the in-flight tick already advances the playhead and the next
        // worker message resumes steady scheduling once it resolves.
        if (schedulerSession.tickInFlight) {
            return;
        }
        schedulerSession.tickInFlight = true;
        try {
            await runTick();
        } finally {
            if (schedulerSession.generation === schedulerGeneration) {
                schedulerSession.tickInFlight = false;
            }
        }
    }

    async function runTick(): Promise<void> {
        if (!cancellation.isCurrent()) {
            return;
        }
        const current = transportStore.value;
        if (!current?.isPlaying) {
            return;
        }

        const now = ctx.currentTime;
        // Clamp the per-tick advance: a suspended/resumed context leaps `now`
        // forward by the whole gap, which would skip every event in between.
        const rawDeltaSec = now - schedulerSession.lastTickTime;
        const deltaSec = Math.max(0, Math.min(rawDeltaSec, MAX_DELTA_SECONDS));
        schedulerSession.lastTickTime = now;

        // Read the live tempo-map reference (stable across ticks unless the store
        // is replaced by an edit) for change detection; fall back to [] only for
        // the actual tempo lookups so an absent map never spuriously invalidates.
        const liveChanges = tempoMapStore.value?.changes ?? null;
        const changes = liveChanges ?? [];

        // A mid-playback tempo-map or loop-region edit changes the beat→time
        // alignment of clips, but the dedup Set still marks them scheduled and
        // would never re-emit them at the new rate. Loop-wrap already clears the
        // Set; this covers the edit-while-playing case. Re-emit by clearing the
        // dedup Sets and tearing down the stale-aligned active sources, exactly as
        // the wrap path does — without moving the playhead or the metronome.
        const loopSignature = loopSignatureOf(current);
        const tempoMapChanged = schedulerSession.lastTempoMapChanges !== liveChanges;
        const loopChanged = schedulerSession.lastLoopSignature !== loopSignature;
        if (tempoMapChanged || loopChanged) {
            schedulerSession.lastTempoMapChanges = liveChanges;
            schedulerSession.lastLoopSignature = loopSignature;
            stopAllScheduled();
            stopActiveSources(schedulerSession.activeAudioSources, ctx);
            schedulerSession.scheduledAudioClips.clear();
            schedulerSession.scheduledFrozenTracks.clear();
        }

        const currentTempo = getTempoAtBeat(changes, schedulerSession.accumulatedPosition, current.tempo);
        const beatsPerSecond = currentTempo / 60;
        const deltaBeats = deltaSec * beatsPerSecond;
        let newPosition = schedulerSession.accumulatedPosition + deltaBeats;

        if (current.isLooping && current.loopEnd > current.loopStart && newPosition >= current.loopEnd) {
            if (current.isRecording) {
                const armedTracks = trackStore.value?.tracks.filter((time) => time.armed) ?? [];
                for (const track of armedTracks) {
                    const laneState = takeLaneStore.value;
                    if (!laneState?.lanes.some((length) => length.trackId === track.id)) {
                        addTakeLane(track.id);
                    }
                    const takeNum =
                        (takeLaneStore.value?.lanes.find((length) => length.trackId === track.id)?.takes.length ?? 0) +
                        1;
                    addTake(
                        track.id,
                        `take-${Date.now()}-${track.id}`,
                        `Take ${takeNum}`,
                        current.loopStart,
                        current.loopEnd
                    );
                }
            }

            const loopLength = current.loopEnd - current.loopStart;
            newPosition = current.loopStart + ((newPosition - current.loopStart) % loopLength);
            schedulerSession.lastScheduledBeat = newPosition - 0.0001;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            stopActiveSources(schedulerSession.activeAudioSources, ctx);
            schedulerSession.scheduledAudioClips.clear();
            schedulerSession.scheduledFrozenTracks.clear();
        }

        const tracks = trackStore.value?.tracks ?? [];
        const { jumpToPosition: rawJumpToPosition, shouldStop } = evaluateFollowActions(
            tracks,
            schedulerSession.accumulatedPosition,
            newPosition
        );
        const jumpToPosition = rawJumpToPosition;

        if (shouldStop) {
            schedulerSession.onStopRequested?.();
            return;
        }

        if (jumpToPosition !== null) {
            newPosition = jumpToPosition;
            schedulerSession.lastScheduledBeat = newPosition;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            stopActiveSources(schedulerSession.activeAudioSources, ctx);
            schedulerSession.scheduledAudioClips.clear();
            schedulerSession.scheduledFrozenTracks.clear();
        }

        schedulerSession.accumulatedPosition = newPosition;
        playheadPositionRef.current = newPosition;

        // Sync to AudioEngine for real-time DSP (SAB-backed)
        audioEngine.setTransportInfo(
            newPosition,
            currentTempo,
            current.isPlaying,
            current.loopStart,
            current.loopEnd,
            current.isLooping
        );

        const hasArmedTracks = trackStore.value?.tracks.some((time) => time.armed) ?? false;
        if (
            current.punchInEnabled &&
            !current.isRecording &&
            !schedulerSession.punchRecordingActive &&
            hasArmedTracks &&
            current.punchInBeat < current.punchOutBeat &&
            newPosition >= current.punchInBeat
        ) {
            schedulerSession.punchRecordingActive = true;
            const clips = startRecording();
            updateTransportState({ isRecording: true });

            const armedTracks = trackStore.value?.tracks.filter((time) => time.armed) ?? [];
            for (const track of armedTracks) {
                if (track.kind === 'audio') {
                    const recClip = clips.find((context) => context.trackId === track.id);
                    void startAudioRecording(track.id, (buffer) => {
                        const bufferId = `rec-${crypto.randomUUID()}`;
                        cacheAudioBuffer({ buffer, bufferId });
                        if (recClip) {
                            // Route the cross-module write through Arrangement's own
                            // use case rather than mutating trackStore directly (audit
                            // row 9). updateClip locates the clip across all tracks and
                            // applies the updater, preserving the prior behaviour.
                            updateClip(recClip.id, (clip) => ({ ...clip, audioBufferId: bufferId }));
                        }
                    });
                }
            }
        }

        if (schedulerSession.punchRecordingActive && current.punchInEnabled && newPosition >= current.punchOutBeat) {
            void stopAudioRecording();
            stopRecording();
            schedulerSession.punchRecordingActive = false;
            updateTransportState({ isRecording: false });
        }

        const lookAheadBeats = SCHEDULE_AHEAD_SECONDS * beatsPerSecond;
        const scheduleUpTo = newPosition + lookAheadBeats;

        scheduleMetronome(
            schedulerSession.lastScheduledBeat,
            scheduleUpTo,
            schedulerSession.accumulatedPosition,
            current,
            currentTempo
        );
        await scheduleMidiNotes(
            schedulerSession.lastScheduledBeat,
            scheduleUpTo,
            schedulerSession.accumulatedPosition,
            schedulerSession.lastScheduledBeat,
            schedulerSession.activeAudioSources,
            current,
            currentTempo,
            cancellation
        );
        if (!cancellation.isCurrent()) {
            return;
        }
        scheduleAudioClips(
            schedulerSession.lastScheduledBeat,
            scheduleUpTo,
            schedulerSession.accumulatedPosition,
            schedulerSession.scheduledAudioClips,
            schedulerSession.scheduledFrozenTracks,
            schedulerSession.activeAudioSources,
            current,
            currentTempo
        );
        applyVcaGains();
        applyAutomation(newPosition);
        applyModulation(newPosition);
        applyModulationToEngine(newPosition);
        scheduleAdjustmentLayers(newPosition);

        schedulerSession.lastScheduledBeat = scheduleUpTo;
    }

    if (!schedulerSession.worker) {
        schedulerSession.worker = new Worker(new URL('../workers/schedulerWorker.ts', import.meta.url), {
            type: 'module',
        });
        schedulerSession.worker.onmessage = (event: MessageEvent<unknown>) => {
            if (event.data && typeof event.data === 'object' && 'type' in event.data && event.data.type === 'tick') {
                void tick();
            }
        };
    }
    schedulerSession.worker.postMessage({ type: 'start', interval: grainMs });
}

import.meta.hot?.dispose(() => {
    disposePlayheadScheduler();
});
