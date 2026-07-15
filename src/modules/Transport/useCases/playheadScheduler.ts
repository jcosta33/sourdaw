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
import {
    startAutomationRecording,
    stopAutomationRecording,
    applyModulation,
    applyModulationToEngine,
} from '#/modules/Automation/useCases';

import { getTempoAtBeat } from '../models/TempoMap';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore } from '../stores/tempoMapStore';
import { transportStore } from '../stores/transportStore';

import { evaluateFollowActions } from './evaluateFollowActions';
import { applyAutomation } from './scheduling/applyAutomation/applyAutomation';
import { applyVcaGains } from './scheduling/applyAutomation/applyVcaGains';
import { disposeAudioClipScheduling } from './scheduling/disposeAudioClipScheduling';
import { resetMetronomeBeat } from './scheduling/resetMetronomeBeat';
import { scheduleAudioClips } from './scheduling/scheduleAudioClips';
import { scheduleMetronome } from './scheduling/scheduleMetronome';
import { scheduleMidiNotes, type SchedulerCancellation } from './scheduling/scheduleMidiNotes';

export type SourceWithFade = AudioBufferSourceNode & { fadeGainNode?: GainNode };

function stopActiveSources(sources: AudioBufferSourceNode[], ctx: BaseAudioContext): void {
    const now = ctx.currentTime;
    for (const src of sources as SourceWithFade[]) {
        try {
            if (src.fadeGainNode) {
                src.fadeGainNode.gain.cancelScheduledValues(now);
                src.fadeGainNode.gain.setValueAtTime(src.fadeGainNode.gain.value, now);
                src.fadeGainNode.gain.linearRampToValueAtTime(0, now + 0.005);
                src.stop(now + 0.005);
            } else {
                src.stop(now + 0.005);
            }
        } catch {
            /* already stopped */
        }
    }
    sources.length = 0;
}

// §28.1 / §107.1 — Coalesce scheduler mutables into a single holder so
// the active playback session lives behind one handle. Mutation is still
// only done from within this file; the holder object prevents importers
// from rebinding any of these via `export let`.
const schedulerSession = {
    worker: null as Worker | null,
    lastTickTime: 0,
    accumulatedPosition: 0,
    lastScheduledBeat: -1,
    scheduledAudioClips: new Set<string>(),
    scheduledFrozenTracks: new Set<string>(),
    activeAudioSources: [] as AudioBufferSourceNode[],
    punchRecordingActive: false,
    onStopRequested: null as (() => void) | null,
    // Re-entrancy guard. `tick` is async and awaits the Yeast Worker round-trip
    // (scheduleMidiNotes); if that awaited work outruns the fixed worker interval
    // (`scheduleGrainMs`, default 10ms), the next worker message would start a
    // second `tick` while the first is still suspended, and both would mutate the
    // shared session mutables (accumulatedPosition, lastScheduledBeat, the dedup
    // Sets, playheadPositionRef) concurrently. The flag makes overlapping worker
    // ticks no-op until the in-flight tick resolves.
    tickInFlight: false,
    // Every start/stop/dispose creates a new scheduler generation. A suspended
    // async tick may still resume after its worker is terminated, so post-await
    // work must prove it belongs to the live generation before it schedules.
    generation: 0,
    // Last-seen tempo-map identity and loop-region signature. A mid-playback edit
    // to either changes the beat→time alignment of already-scheduled clips, but
    // the dedup Set would keep them suppressed; we detect the change and invalidate.
    lastTempoMapChanges: null as unknown[] | null,
    lastLoopSignature: '',
};

function loopSignatureOf(state: { isLooping: boolean; loopStart: number; loopEnd: number }): string {
    return `${state.isLooping ? 1 : 0}:${state.loopStart}:${state.loopEnd}`;
}

/**
 * Wire the scheduler's follow-action stop path to the full `stopPlayback`
 * routine. Registered once from `src/app/bootstrap.ts` after all modules
 * have loaded, so the scheduler never needs a static or dynamic import of
 * `stopPlayback` (which would form a scheduler ↔ stopPlayback cycle).
 *
 * If the callback has not been registered yet (e.g. during tests that boot
 * the scheduler directly), the follow-action `shouldStop` branch is a no-op.
 */
export function setStopPlaybackCallback(fn: () => void): void {
    schedulerSession.onStopRequested = fn;
}

const SCHEDULE_AHEAD_SECONDS = 0.1;

/**
 * Upper bound on a single tick's elapsed real time before we advance the
 * playhead. If the AudioContext is suspended and later resumed (tab
 * backgrounded, OS sleep, device unplugged) `ctx.currentTime` leaps forward by
 * the whole gap; an unclamped `deltaSec` would jump `accumulatedPosition` past
 * an entire span of beats the look-ahead never scheduled, dropping every
 * metronome click, MIDI note, and audio clip in between. Clamping to one grain
 * window keeps advancement bounded so the next ticks re-schedule normally
 * instead of skipping. The clock leap itself is absorbed (the playhead simply
 * does not race ahead), which is the correct behaviour for a paused context.
 */
const MAX_DELTA_SECONDS = SCHEDULE_AHEAD_SECONDS;

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
            stopAudioRecording();
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

export function stopPlayheadScheduler(): void {
    schedulerSession.generation += 1;
    stopAutomationRecording();
    if (schedulerSession.worker) {
        schedulerSession.worker.postMessage({ type: 'stop' });
        schedulerSession.worker.terminate();
        schedulerSession.worker = null;
    }
    if (schedulerSession.punchRecordingActive) {
        stopAudioRecording();
        stopRecording();
        schedulerSession.punchRecordingActive = false;
    }
    schedulerSession.lastTickTime = 0;
    schedulerSession.accumulatedPosition = 0;
    schedulerSession.lastScheduledBeat = -1;
    schedulerSession.tickInFlight = false;
    resetMetronomeBeat(0);
    schedulerSession.scheduledAudioClips.clear();
    schedulerSession.scheduledFrozenTracks.clear();
    const ctx = getAudioContext();
    stopActiveSources(schedulerSession.activeAudioSources, ctx);
    stopAllScheduled();
}

/**
 * Tear down all process-lifetime scheduler state. `schedulerSession` and
 * `sessionState.requestedAssets` (in scheduleAudioClips) plus the GainNode pool
 * are module-level holders that otherwise survive an HMR reload or a project
 * switch — the old `tick` worker keeps running against stale closures, the
 * dedup Sets keep clips suppressed, and the pool keeps GainNodes wired into a
 * discarded AudioContext alive. Disposing terminates the worker, stops active
 * sources, clears every dedup Set and the requested-asset set, drops the stop
 * callback, and resets the change-detection signatures so a fresh session
 * starts clean.
 */
export function disposePlayheadScheduler(): void {
    schedulerSession.generation += 1;
    if (schedulerSession.worker) {
        schedulerSession.worker.postMessage({ type: 'stop' });
        schedulerSession.worker.terminate();
        schedulerSession.worker = null;
    }
    try {
        const ctx = getAudioContext();
        stopActiveSources(schedulerSession.activeAudioSources, ctx);
    } catch {
        // AudioContext may already be gone on teardown; still drop the references.
        schedulerSession.activeAudioSources.length = 0;
    }
    schedulerSession.lastTickTime = 0;
    schedulerSession.accumulatedPosition = 0;
    schedulerSession.lastScheduledBeat = -1;
    schedulerSession.punchRecordingActive = false;
    schedulerSession.tickInFlight = false;
    schedulerSession.scheduledAudioClips.clear();
    schedulerSession.scheduledFrozenTracks.clear();
    schedulerSession.onStopRequested = null;
    schedulerSession.lastTempoMapChanges = null;
    schedulerSession.lastLoopSignature = '';
    resetMetronomeBeat(0);
    disposeAudioClipScheduling();
}

// Vite HMR: dispose all scheduler holders before this module is replaced so a
// reload never leaves an orphaned worker ticking against stale closures or a
// pool of GainNodes bound to a discarded AudioContext.
import.meta.hot?.dispose(() => {
    disposePlayheadScheduler();
});
