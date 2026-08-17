import { logger } from '#/infra/logger/appLogger';
import { trackStore, takeLaneStore } from '#/modules/Arrangement/stores';
import { startRecording, stopRecording, addTakeLane, addTake, updateClip } from '#/modules/Arrangement/useCases';
import {
    stopAllScheduled,
    startAudioRecording,
    stopAudioRecording,
    getAudioContext,
    getCompensationDelay,
    audioEngine,
    scheduleAdjustmentLayers,
    cacheAudioBuffer,
    refreshSidechainAlignment,
} from '#/modules/AudioEngine/useCases';
import { startAutomationRecording, applyModulation, applyModulationToEngine } from '#/modules/Automation/useCases';

import { getTempoAtBeat } from '../../models/TempoMap';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';
import { evaluateFollowActions } from '../evaluateFollowActions';
import { appliedAutomationBases } from '../scheduling/applyAutomation/appliedAutomationBases';
import { applyAutomation } from '../scheduling/applyAutomation/applyAutomation';
import { applyVcaGains } from '../scheduling/applyAutomation/applyVcaGains';
import { resetMetronomeBeat } from '../scheduling/resetMetronomeBeat';
import { scheduleAudioClips } from '../scheduling/scheduleAudioClips';
import { scheduleMetronome } from '../scheduling/scheduleMetronome';
import { scheduleMidiNotes, type SchedulerCancellation } from '../scheduling/scheduleMidiNotes';
import { panicYeastRuntime } from '../transportControls/panicYeastRuntime';

import { advanceSchedulerDiscontinuityEpoch } from './advanceSchedulerDiscontinuityEpoch';
import { disposePlayheadScheduler } from './disposePlayheadScheduler';
import { schedulerSession, stopActiveSources } from './schedulerSession';
import { schedulerTimingDiagnostics } from './schedulerTimingDiagnostics';

function loopSignatureOf(state: { isLooping: boolean; loopStart: number; loopEnd: number }): string {
    return `${state.isLooping ? 1 : 0}:${state.loopStart}:${state.loopEnd}`;
}

const SCHEDULE_AHEAD_SECONDS = 0.1;

type SchedulerWorkerTick = {
    type: 'tick';
    generation: number;
    sequence: number;
    scheduledAtMs: number;
    sentAtMs: number;
};

// Window and Worker timestamps share the High Resolution Time monotonic clock,
// but browser privacy quantization can round two adjacent reads differently.
// One millisecond is well below the scheduler grain while still rejecting
// genuinely future-dated messages.
const CLOCK_PRECISION_TOLERANCE_MS = 1;

function highResolutionEpochMs(): number {
    return performance.timeOrigin + performance.now();
}

function isSchedulerWorkerTick(value: unknown, receivedAtMs: number): value is SchedulerWorkerTick {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return (
        'type' in value &&
        value.type === 'tick' &&
        'generation' in value &&
        typeof value.generation === 'number' &&
        Number.isSafeInteger(value.generation) &&
        value.generation > 0 &&
        'sequence' in value &&
        typeof value.sequence === 'number' &&
        Number.isSafeInteger(value.sequence) &&
        value.sequence > 0 &&
        'scheduledAtMs' in value &&
        typeof value.scheduledAtMs === 'number' &&
        Number.isFinite(value.scheduledAtMs) &&
        'sentAtMs' in value &&
        typeof value.sentAtMs === 'number' &&
        Number.isFinite(value.sentAtMs) &&
        value.sentAtMs >= value.scheduledAtMs &&
        value.sentAtMs <= receivedAtMs + CLOCK_PRECISION_TOLERANCE_MS
    );
}

/**
 * How far behind the live position the MIDI high-water mark is rewound when a
 * window has to be re-emitted. The normal gate is the half-open interval
 * `[lastScheduledBeat, scheduleUpTo)`. Rewinding by this amount also re-opens
 * notes infinitesimally before the live position after their scheduled voices
 * have been stopped.
 *
 * Only the tempo/loop-edit re-emit uses it. The loop-wrap and follow-action
 * paths are relocations, not re-emissions: they anchor on the destination beat
 * itself (`loopStart`, `jumpToPosition`) because the gate is already inclusive
 * there, and an extra nudge below would emit the destination twice.
 */
const REEMIT_EPSILON_BEATS = 0.0001;

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
    advanceSchedulerDiscontinuityEpoch();
    const schedulerGeneration = schedulerSession.generation;
    schedulerSession.tickInFlight = false;
    const cancellation: SchedulerCancellation = {
        generation: schedulerGeneration,
        get discontinuityEpoch() {
            return schedulerSession.discontinuityEpoch;
        },
        isCurrent: () =>
            schedulerSession.generation === schedulerGeneration && transportStore.value?.isPlaying === true,
        yeastRouteLineage: new Map(),
    };

    startAutomationRecording();

    const ctx = getAudioContext();

    // Drop any scheduler state inherited from a previous session before this
    // one starts ticking. A play pressed during pausePlayback's recording-flush
    // window skips the pause teardown (the stale continuation bails when
    // isPlaying flipped back), so without this the dedup Sets would keep the
    // frozen track scheduled in the old session suppressed — silent for the
    // whole new session — while the old frozen source keeps playing out of
    // sync with the restarted playhead. For every caller that came through a
    // full teardown (stop/dispose already cleared these) this is a no-op.
    schedulerSession.scheduledAudioClips.clear();
    schedulerSession.scheduledFrozenTracks.clear();
    stopActiveSources(schedulerSession.activeAudioSources, ctx);

    schedulerSession.lastTickTime = ctx.currentTime;
    schedulerSession.accumulatedPosition = state.playheadPosition;
    playheadPositionRef.current = state.playheadPosition;
    schedulerSession.lastScheduledBeat = state.playheadPosition - 0.0001;
    schedulerSession.lastTempoMapChanges = tempoMapStore.value?.changes ?? null;
    schedulerSession.lastLoopSignature = loopSignatureOf(state);
    resetMetronomeBeat(state.playheadPosition);

    const grainMs = state.scheduleGrainMs;
    schedulerTimingDiagnostics.reset(grainMs);

    async function tick(): Promise<void> {
        // Second line of defence, not the primary filter: `worker.onmessage`
        // already drops a message whose generation is not the live one, so on
        // the message path this is unreachable. It covers the gap between that
        // check and this body — a retirement landing in between, or any future
        // caller that reaches `tick` without going through `onmessage`. Bail
        // before touching `tickInFlight`, because the flag then belongs to
        // whichever session is live: `runTick` bails on the same generation
        // check, and the `finally` below refuses to release a flag owned by
        // another generation, so a claim made here would stay stuck true and
        // every tick of the live session would be skipped at the in-flight
        // guard — the playhead freezes while the transport still reads playing.
        if (schedulerSession.generation !== schedulerGeneration) {
            return;
        }
        // A prior tick is still awaiting its scheduling work (the Yeast Worker
        // round-trip in particular). Starting now would let two ticks mutate the
        // shared session mutables across one another's awaits. Skip this worker
        // tick; the in-flight tick already advances the playhead and the next
        // worker message resumes steady scheduling once it resolves.
        if (schedulerSession.tickInFlight) {
            schedulerTimingDiagnostics.recordTickSkipped();
            return;
        }
        schedulerSession.tickInFlight = true;
        const tickStartedAtMs = highResolutionEpochMs();
        try {
            await runTick();
        } finally {
            if (schedulerSession.generation === schedulerGeneration) {
                schedulerTimingDiagnostics.recordTickSettled(highResolutionEpochMs() - tickStartedAtMs);
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
            // MIDI notes have no dedup Set — they are gated by the monotonic
            // high-water mark, which `stopAllScheduled`'s allNotesOff does not
            // move. Without rewinding it, every note already emitted into the
            // current look-ahead is silenced here and then blocked from
            // re-emission (`unswungStartBeat < lastScheduledBeat`), so a
            // tempo or loop edit drops a window of notes outright while audio
            // clips re-align (audit MD-5). Rewinding to the live position
            // re-opens exactly the window that was just cut, at the new rate.
            // The metronome is unaffected: it dedups on its own `lastBeat` and
            // on already-fired click times, neither of which this touches.
            schedulerSession.lastScheduledBeat = schedulerSession.accumulatedPosition - REEMIT_EPSILON_BEATS;
        }

        const currentTempo = getTempoAtBeat(changes, schedulerSession.accumulatedPosition, current.tempo);
        const beatsPerSecond = currentTempo / 60;
        const deltaBeats = deltaSec * beatsPerSecond;
        let newPosition = schedulerSession.accumulatedPosition + deltaBeats;
        // Where this tick's window opens, before the advance below commits
        // `newPosition`. Punch-in needs it to tell "rolled across the punch
        // point during this tick" from "was already inside the region when the
        // transport started". A relocation restarts the window at its
        // destination, so re-anchor this alongside `lastScheduledBeat`.
        let tickStartPosition = schedulerSession.accumulatedPosition;
        let rackDiscontinuity = false;

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
            advanceSchedulerDiscontinuityEpoch();
            rackDiscontinuity = true;
            // Anchor the next window at the seam itself, not at the wrapped
            // playhead. The wrap only fires once `newPosition >= loopEnd`, so
            // after the modulo `newPosition` is `loopStart + overshoot` — up to
            // one whole clamped tick past the seam. Anchoring there left
            // `[loopStart, loopStart + overshoot)` outside the half-open gate
            // `[lastScheduledBeat, scheduleUpTo)`, and the pre-wrap look-ahead
            // could not have covered it either: that window ran past `loopEnd`
            // into post-loop material, which `stopAllScheduled()` below then
            // cancels. So the note on the loop start was never emitted on any
            // pass whose overshoot exceeded the old epsilon — at 120 BPM and a
            // 10 ms grain, essentially all of them. `loopStart` exactly, with
            // no epsilon: the gate is already inclusive at its lower bound, and
            // nudging below it would re-open the seam a second time.
            schedulerSession.lastScheduledBeat = current.loopStart;
            tickStartPosition = current.loopStart;
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
            advanceSchedulerDiscontinuityEpoch();
            rackDiscontinuity = true;
            schedulerSession.lastScheduledBeat = newPosition;
            tickStartPosition = newPosition;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            stopActiveSources(schedulerSession.activeAudioSources, ctx);
            schedulerSession.scheduledAudioClips.clear();
            schedulerSession.scheduledFrozenTracks.clear();
        }

        if (rackDiscontinuity) {
            await panicYeastRuntime();
            if (!cancellation.isCurrent()) {
                return;
            }
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
            newPosition >= current.punchInBeat &&
            // Upper bound. Without it, starting playback past the region fires
            // punch-in and punch-out on the same tick: a full-width clip and
            // take are stamped across [punchInBeat, punchOutBeat) and captured
            // nothing. Punching in only makes sense while the region is still
            // ahead of the tick's end.
            newPosition < current.punchOutBeat
        ) {
            schedulerSession.punchRecordingActive = true;
            // Anchor the punched clip where capture actually begins. The tick is
            // already up to one grain past the region start when the crossing is
            // detected, so `punchInBeat` is the right anchor when the transport
            // rolled across it during this tick. When playback *started* inside
            // the region the capture begins at the entry beat instead, and
            // anchoring at `punchInBeat` would displace the take backwards by
            // the whole distance already covered, leaving the tail silent.
            // `tickStartPosition` is the window's own opening beat, so the max
            // of the two is the first beat this recording can contain.
            // `startRecording`'s default (the transport store's playhead) is
            // wrong on both paths — nothing writes it during playback.
            const punchAnchorBeat = Math.max(current.punchInBeat, tickStartPosition);
            const clips = startRecording(punchAnchorBeat);
            updateTransportState({ isRecording: true });

            const armedTracks = trackStore.value?.tracks.filter((time) => time.armed) ?? [];
            for (const track of armedTracks) {
                if (track.kind === 'midi') {
                    const recClip = clips.find((context) => context.trackId === track.id);
                    if (recClip) {
                        // Input-latency compensation shifts a recorded note
                        // earlier by the round-trip time. With the clip origin
                        // sitting exactly on the anchor, a note played on the
                        // punch downbeat has nowhere to go: the clip-relative
                        // beat clamps at 0 and the note is stored uncompensated,
                        // late by the round trip, unrecoverably. A media lead-in
                        // of the same size moves the clip's media origin earlier
                        // (`origin = startBeat - midiOffsetBeats`) while leaving
                        // `startBeat` on the punch point, so the compensation is
                        // representable and the clip still begins where the user
                        // asked. Derived exactly as the manual record path does
                        // (handleWebMidiNoteOff), so both agree on the origin.
                        const totalLatencySec =
                            (ctx.baseLatency || 0) + (ctx.outputLatency || 0) + getCompensationDelay(track.id);
                        const leadInBeats = (totalLatencySec * currentTempo) / 60;
                        if (leadInBeats > 0) {
                            updateClip(recClip.id, (clip) => ({ ...clip, midiOffsetBeats: leadInBeats }));
                        }
                    }
                }
                if (track.kind === 'audio') {
                    const recClip = clips.find((context) => context.trackId === track.id);
                    Promise.resolve(
                        startAudioRecording(track.id, (buffer) => {
                            const bufferId = `rec-${crypto.randomUUID()}`;
                            cacheAudioBuffer({ buffer, bufferId });
                            if (recClip) {
                                // Route the cross-module write through Arrangement's own
                                // use case rather than mutating trackStore directly (audit
                                // row 9). updateClip locates the clip across all tracks and
                                // applies the updater, preserving the prior behaviour.
                                updateClip(recClip.id, (clip) => ({ ...clip, audioBufferId: bufferId }));
                            }
                        })
                    ).catch((error: unknown) => {
                        logger.error(new Error('Punch-in audio recording failed to start', { cause: error }));
                    });
                }
            }
        }

        if (schedulerSession.punchRecordingActive && current.punchInEnabled && newPosition >= current.punchOutBeat) {
            await Promise.resolve(stopAudioRecording()).catch((error: unknown) => {
                logger.error(new Error('Punch-out audio recording failed to stop', { cause: error }));
            });
            if (!cancellation.isCurrent()) {
                return;
            }
            // Same anchoring as punch-in: the region's own end beat, not the
            // overshooting tick position and not the stale store playhead.
            stopRecording(current.punchOutBeat);
            schedulerSession.punchRecordingActive = false;
            updateTransportState({ isRecording: false });
        }

        const lookAheadBeats = SCHEDULE_AHEAD_SECONDS * beatsPerSecond;
        const scheduleUpTo = newPosition + lookAheadBeats;

        scheduleMetronome(
            schedulerSession.lastScheduledBeat,
            scheduleUpTo,
            schedulerSession.accumulatedPosition,
            current
        );
        await scheduleMidiNotes(
            schedulerSession.lastScheduledBeat,
            scheduleUpTo,
            schedulerSession.accumulatedPosition,
            schedulerSession.scheduledFrozenTracks,
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
            current
        );
        // applyAutomation runs first and returns the tracks whose fader gain it
        // composed (VCA multiplier folded in); applyVcaGains then drives only the
        // VCA-member tracks it did NOT write, so the two never race the fader.
        const gainAutomatedTrackIds = applyAutomation(newPosition);
        applyVcaGains(gainAutomatedTrackIds);
        // FX-5 — same per-tick recompute discipline applyAutomation uses for its
        // compensation: a latency change anywhere (native plugin push, device
        // added/removed/bypassed) moves the sidechain key alignment within one
        // grain instead of holding a stale value for the rest of the session.
        refreshSidechainAlignment();
        applyModulation(newPosition);
        // Hand modulation the values applyAutomation just applied, so a
        // param both automated and modulated combines onto the value the engine
        // actually holds rather than a separately recomputed raw curve value.
        applyModulationToEngine(newPosition, schedulerSession.discontinuityEpoch, appliedAutomationBases);
        scheduleAdjustmentLayers(newPosition);

        schedulerSession.lastScheduledBeat = scheduleUpTo;
    }

    let worker = schedulerSession.worker;
    if (!worker) {
        worker = new Worker(new URL('../../workers/schedulerWorker.ts', import.meta.url), {
            type: 'module',
        });
        schedulerSession.worker = worker;
    }
    worker.onmessage = (event: MessageEvent<unknown>) => {
        const receivedAtMs = highResolutionEpochMs();
        if (
            !isSchedulerWorkerTick(event.data, receivedAtMs) ||
            event.data.generation !== schedulerGeneration ||
            schedulerSession.generation !== schedulerGeneration
        ) {
            return;
        }
        schedulerTimingDiagnostics.recordTickMessage(
            event.data.sequence,
            event.data.scheduledAtMs,
            event.data.sentAtMs,
            receivedAtMs
        );
        tick().catch((error: unknown) => {
            logger.error(new Error('Transport scheduler tick failed', { cause: error }));
        });
    };
    worker.postMessage({ type: 'start', interval: grainMs, generation: schedulerGeneration });
}

// Vite HMR: dispose all scheduler holders before this module is replaced so a
// reload never leaves an orphaned worker ticking against stale closures or a
// pool of GainNodes bound to a discarded AudioContext. Registered here — not in
// disposePlayheadScheduler.ts — because this is the scheduler module in the
// production import graph (via transportControls), so the hook actually runs;
// editing any module this file imports (schedulerSession, the scheduling
// helpers) invalidates this module and fires the hook, matching the coverage
// the pre-split monolith had.
import.meta.hot?.dispose(() => {
    disposePlayheadScheduler();
});
