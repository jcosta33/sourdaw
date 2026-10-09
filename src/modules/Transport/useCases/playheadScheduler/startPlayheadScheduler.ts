import { logger } from '#/infra/logger/appLogger';
import { trackStore, takeLaneStore, activeRecordingRef } from '#/modules/Arrangement/stores';
import {
    startRecording,
    updateClip,
    discardRecording,
    commitRecording,
    stageRecordingTake,
} from '#/modules/Arrangement/useCases';
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
import { notifyUser } from '#/utils/Notification/notifyUser';

import { BEAT_EPSILON, getTempoAtBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadClockRef } from '../../stores/playheadClockRef';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { playheadWrapCountRef } from '../../stores/playheadWrapCountRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';
import { evaluateFollowActions } from '../evaluateFollowActions';
import { appliedAutomationBases } from '../scheduling/applyAutomation/appliedAutomationBases';
import { applyAutomation } from '../scheduling/applyAutomation/applyAutomation';
import { applyVcaGains } from '../scheduling/applyAutomation/applyVcaGains';
import { deviceReadBeatByTrack } from '../scheduling/applyAutomation/deviceReadBeatByTrack';
import { discardStaleStoredMoves } from '../scheduling/discardStaleStoredMoves';
import { resetMetronomeBeat } from '../scheduling/resetMetronomeBeat';
import { scheduleAudioClips } from '../scheduling/scheduleAudioClips';
import { scheduleMetronome } from '../scheduling/scheduleMetronome';
import { scheduleMidiNotes, type SchedulerCancellation } from '../scheduling/scheduleMidiNotes';
import { finalizeAutomaticRecording } from '../transportControls/finalizeAutomaticRecording';
import { panicYeastRuntime } from '../transportControls/panicYeastRuntime';
import { recordingLifecycle } from '../transportControls/recordingLifecycle';

import { advanceSchedulerDiscontinuityEpoch } from './advanceSchedulerDiscontinuityEpoch';
import { beatAtSecondsFromAnchor } from './beatAtSecondsFromAnchor';
import { disposePlayheadScheduler } from './disposePlayheadScheduler';
import { readNativeEngineCursorBeats } from './readNativeEngineCursorBeats';
import { schedulerSession, stopActiveSources } from './schedulerSession';
import { schedulerTimingDiagnostics } from './schedulerTimingDiagnostics';

function loopSignatureOf(state: { isLooping: boolean; loopStart: number; loopEnd: number }): string {
    return `${state.isLooping ? 1 : 0}:${state.loopStart}:${state.loopEnd}`;
}

function positiveModulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

/**
 * #4656 — one loop seam, detected while the look-ahead horizon crosses loopEnd
 * and scheduled ahead of the audio clock instead of after the playhead has
 * passed it. The tick emits two windows: the dying pass's remainder (clipped
 * at the loop end) and the incoming pass's opening window at audio times
 * continuing from the seam instant, so the loop-start downbeat is requested
 * before it is due and nothing past loopEnd is ever scheduled while looping.
 */
type LoopSeamEmission = {
    /** The audio-clock instant both passes pivot on. */
    seamAudioTime: number;
    /** The dying pass's position at `now`; emits its remaining window. */
    passPosition: number;
    /** The dying pass's scheduling high-water mark; its window opens there. */
    passHighWater: number;
    /** Half-open end of the dying pass's window, at the loop end. */
    passUpTo: number;
    /** Half-open end of the incoming pass's window, on its own beats. */
    wrappedUpTo: number;
};

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

/**
 * Stage the wrap take for every armed track with a clip that is actively
 * recording. Both loop-wrap paths share it — the late wrap (playhead crossed
 * loopEnd this tick) and the scheduled seam (#4656, one look-ahead earlier) —
 * because the takes are pass spans, not playhead reads: each names the
 * recording clip and its [loopStart, loopEnd) slice, so staging them at the
 * horizon instead of the crossing changes when they appear, not what they
 * contain.
 */
function stageLoopWrapTakes(current: TransportState, passEndContextSeconds: number): void {
    if (!current.isRecording) {
        return;
    }
    const recordingClipIds = new Set(activeRecordingRef.current);
    const armedTracks = trackStore.value?.tracks.filter((time) => time.armed) ?? [];
    for (const track of armedTracks) {
        // The take must reference the clip that is actually recording
        // this pass. A synthesized clipId matches no clip in the
        // store, and comp resolution silently skips a take whose
        // clip lookup fails — so loop-recorded takes never reached
        // the comp at all. One clip records across every pass until
        // stopRecording; each wrap take names that clip.
        const recordingClip = track.clips.find((clip) => recordingClipIds.has(clip.id));
        if (!recordingClip) {
            continue;
        }
        const lane = takeLaneStore.value?.lanes.find((length) => length.trackId === track.id);
        const takeNum = (lane?.takes.length ?? 0) + 1;
        // Each pass needs its own identity inside the one
        // continuously recorded clip: every wrap take names the
        // same clipId and bounds, so without a per-take source
        // offset comp resolution would read the first pass's PCM
        // for every take. The initial take (from `startRecording`)
        // is pass 1 at the clip origin; each take already minted
        // for THIS recording marks one more completed pass.
        //
        // Pass 1's media span depends on where recording began:
        // started before the loop, the run-up precedes it, so pass 1
        // begins `loopStart - clip.startBeat` into the buffer and
        // spans a full loop length; started inside the loop, there
        // is no run-up and the first pass is short — it ends when
        // the playhead wraps at loopEnd, so its media length is
        // `loopEnd - clip.startBeat` and pass 2 begins right after
        // it. Later passes always span the full loop length. The
        // offset stays relative to the clip's media origin, which
        // is why the finalization-time latency shift of
        // `clip.startBeat` cannot invalidate it.
        const priorPassTakes = lane?.takes.filter((take) => recordingClipIds.has(take.clipId)).length ?? 0;
        const passIndex = Math.max(0, priorPassTakes - 1);
        const loopLength = current.loopEnd - current.loopStart;
        const runUpBeats = Math.max(0, current.loopStart - recordingClip.startBeat);
        const startedInsideLoop =
            recordingClip.startBeat > current.loopStart && recordingClip.startBeat < current.loopEnd;
        const firstPassStart = runUpBeats;
        const firstPassLength = startedInsideLoop ? current.loopEnd - recordingClip.startBeat : loopLength;
        const sourceOffsetBeats =
            firstPassStart + (passIndex === 0 ? 0 : firstPassLength + (passIndex - 1) * loopLength);
        // Every wrap take is provisional: the whole recording — audio
        // or MIDI — commits as the one entry its terminal callback (or
        // `stopRecording`) opens rather than one entry per pass.
        stageRecordingTake({
            trackId: track.id,
            clipId: recordingClip.id,
            name: `Take ${takeNum}`,
            startBeat: current.loopStart,
            endBeat: current.loopEnd,
            sourceOffsetBeats,
            passEndContextSeconds,
        });
    }
}

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
    schedulerSession.lastLoopSeamAudioTime = null;
    stopActiveSources(schedulerSession.activeAudioSources, ctx);

    schedulerSession.lastTickTime = ctx.currentTime;
    schedulerSession.accumulatedPosition = state.playheadPosition;
    playheadClockRef.beat = state.playheadPosition;
    playheadClockRef.audioTimeSeconds = ctx.currentTime;
    playheadPositionRef.current = state.playheadPosition;
    // A new roll begins at this store position, so its wrap history starts
    // here too: the count must describe the same epoch the store position
    // does, or a backwards capture bounds at the wrong traversal.
    playheadWrapCountRef.current = 0;
    schedulerSession.lastScheduledBeat = state.playheadPosition - 0.0001;
    schedulerSession.lastTempoMapChanges = tempoMapStore.value?.changes ?? null;
    schedulerSession.lastLoopSignature = loopSignatureOf(state);
    schedulerSession.pendingSeam = null;
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
        // The previous tick's clock instant, before the overwrite below. A
        // pending seam re-anchors on it (below): the main integration then
        // carries the re-anchored position across this tick's own `deltaSec`,
        // landing exactly on `now`. Integrating the anchor all the way to `now`
        // first counted the previous-tick-to-now span twice — notes re-emitted
        // after the edit fired one grain early and the loop wrapped one grain
        // early.
        const previousTickTime = schedulerSession.lastTickTime;
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
        // the wrap path does. A pending seam is re-anchored on the dying pass
        // (below); otherwise the playhead and the metronome stay where they are.
        const loopSignature = loopSignatureOf(current);
        const tempoMapChanged = schedulerSession.lastTempoMapChanges !== liveChanges;
        const loopChanged = schedulerSession.lastLoopSignature !== loopSignature;
        let rackDiscontinuity = false;
        // #4905 — set when a wrap arm runs this tick (the seam-edit re-anchor
        // below or the late wrap further down): the dying pass crossed loopEnd,
        // and the wrap replaced the scanned position before the punch checks
        // below.
        let lateWrap = false;
        let lateWrapSeamAudioTime: number | null = null;
        // Set when an edit's teardown cuts the look-ahead: the window that
        // re-emits it opens where playback stands (or at the loop start), and
        // like a jump's it must restore the stored controllers in force there.
        let reemitAfterEdit = false;
        if (tempoMapChanged || loopChanged) {
            schedulerSession.lastTempoMapChanges = liveChanges;
            schedulerSession.lastLoopSignature = loopSignature;
            // A wrap tail the fence was sparing is gone with the teardown, and
            // the region the seam pivoted on may be the one this edit replaced:
            // the device read must not map back across it (#4784).
            schedulerSession.lastLoopSeamAudioTime = null;
            stopAllScheduled();
            // The teardown stops notes, not pedals or controllers (a controller
            // is state), so the stored moves still queued for the cut look-ahead
            // would apply at their old frames after the re-emitted window: drop
            // them on every device stored playback posted to. The re-emitted
            // window restores the values in force where it opens and lifts a
            // pedal only where nothing is in force, so a pedal the lane holds
            // down is never lifted and pressed again.
            discardStaleStoredMoves();
            reemitAfterEdit = true;
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
            //
            // A pending loop seam is anchored against the map this edit just
            // replaced: its seam instant, its dying-pass anchor, and the
            // incoming pass's negative-phase integration all describe the old
            // timeline. Keeping it publishes the old anchor under the new map
            // and strands the scheduler in negative phase once the stale
            // instant passes; rewinding the high-water mark onto the
            // negative-phase position below would re-open the emission window
            // at the incoming phase, so the dying pass's remaining material —
            // just cut by the teardown — would never re-emit. Re-anchor on the
            // dying pass instead: integrate its anchored position to the
            // PREVIOUS tick's instant through the NEW map and resume there —
            // the main integration below then advances it by this tick's
            // `deltaSec` onto `now`, exactly as an ordinary tick would have
            // before the seam was detected. Integrating the anchor all the way
            // to `now` counted the previous-tick-to-now span twice: notes
            // re-emitted after the edit fired one grain early and the loop
            // wrapped one grain early. That keeps the published clock inside
            // [loopStart, loopEnd]. An edit that lands after the stale seam
            // instant has already carried the pass boundary — fall through to
            // an ordinary wrap.
            if (schedulerSession.pendingSeam !== null) {
                const { anchorAudioTime, anchorPosition } = schedulerSession.pendingSeam;
                schedulerSession.pendingSeam = null;
                const dyingPositionAtPreviousTick = beatAtSecondsFromAnchor(
                    changes,
                    anchorPosition,
                    previousTickTime - anchorAudioTime,
                    current.tempo
                );
                if (
                    current.isLooping &&
                    current.loopEnd > current.loopStart &&
                    dyingPositionAtPreviousTick >= current.loopEnd
                ) {
                    // #4905 — this arm carries the same wrap law as the late
                    // wrap: the dying pass crossed loopEnd before the edit, the
                    // re-anchored position below is the incoming pass's, and a
                    // region at or below the look-ahead never presents a scan
                    // at or past the punch-out beat afterwards — a punch
                    // recording open across the wrap is due at the wrap itself.
                    // Its pass-span takes stage with the late wrap's, after the
                    // punch checks below, not here.
                    lateWrap = true;
                    const loopLength = current.loopEnd - current.loopStart;
                    schedulerSession.accumulatedPosition =
                        current.loopStart + positiveModulo(dyingPositionAtPreviousTick - current.loopStart, loopLength);
                    // The gate is inclusive at its lower bound, so `loopStart`
                    // exactly — the same anchor the wrap paths use.
                    schedulerSession.lastScheduledBeat = current.loopStart;
                    resetMetronomeBeat(schedulerSession.accumulatedPosition);
                    advanceSchedulerDiscontinuityEpoch();
                    rackDiscontinuity = true;
                } else {
                    schedulerSession.accumulatedPosition = dyingPositionAtPreviousTick;
                    schedulerSession.lastScheduledBeat = dyingPositionAtPreviousTick - REEMIT_EPSILON_BEATS;
                }
            } else {
                schedulerSession.lastScheduledBeat = schedulerSession.accumulatedPosition - REEMIT_EPSILON_BEATS;
            }
        }

        const currentTempo = getTempoAtBeat(changes, schedulerSession.accumulatedPosition, current.tempo);
        const beatsPerSecond = currentTempo / 60;
        // Advance through the tempo map, not at the tick-start tempo (#4658).
        // `beatAtSecondsFromAnchor` inverts `secondsBetweenBeats` over this
        // tick's elapsed span, so a tick crossing a tempo change moves the
        // position the exact integrated distance instead of the whole span at
        // the left-endpoint rate — the position no longer accumulates the
        // crossing error, and at every tick `accumulatedPosition` equals the
        // tempo map's beat at the current audio time. With a flat map this is
        // exactly the old `accumulated + deltaSec * beatsPerSecond`.
        let newPosition = beatAtSecondsFromAnchor(
            changes,
            schedulerSession.accumulatedPosition,
            deltaSec,
            current.tempo
        );
        // Where this tick's window opens, before the advance below commits
        // `newPosition`. Punch-in needs it to tell "rolled across the punch
        // point during this tick" from "was already inside the region when the
        // transport started". A relocation restarts the window at its
        // destination, so re-anchor this alongside `lastScheduledBeat`.
        let tickStartPosition = schedulerSession.accumulatedPosition;
        // The dying pass's own window opening. The seam branch below repoints
        // `tickStartPosition` at the incoming pass's `loopStart`, but a punch
        // decided on a seam tick belongs to the dying pass and anchors on the
        // window that was open when its region was crossed.
        const dyingTickStartPosition = tickStartPosition;

        const lookAheadBeats = SCHEDULE_AHEAD_SECONDS * beatsPerSecond;
        // The horizon used to DETECT the seam. The emitted window is derived
        // from the committed position further down — a follow action may still
        // relocate the transport past this point, and its window opens at the
        // destination, not here.
        const horizonUpTo = newPosition + lookAheadBeats;

        let seam: LoopSeamEmission | null = null;

        // Both wrap paths only fire for a playhead inside (or before) the
        // region. A playhead already at or past loopEnd plays straight through
        // untouched: that is the native engine's stated meaning of a locate
        // past loopEnd (scheduler.rs frames_until_loop_end) and
        // projectRollPosition (#4117).
        const insideLoopRegion =
            current.isLooping &&
            current.loopEnd > current.loopStart &&
            schedulerSession.accumulatedPosition < current.loopEnd;
        // The scheduled seam hands a pass over one look-ahead early, so it can
        // only serve a region longer than that look-ahead: in a shorter one the
        // horizon crosses again the moment the wrapped position rises clear of
        // loopEnd minus the look-ahead, and the seam branch re-arms on
        // consecutive ticks — advancing the discontinuity epoch and panicking
        // the rack many times per physical wrap. Such regions keep the old
        // post-crossing wrap: exactly one discontinuity per boundary.
        const seamCapableRegion = current.loopEnd - current.loopStart > lookAheadBeats;

        if (insideLoopRegion && newPosition >= current.loopEnd) {
            // Late wrap: the playhead itself crossed loopEnd this tick. Only
            // reachable when a clock leap or stall outran the look-ahead (or
            // an edit moved the region onto the playhead) — the scheduled
            // seam below otherwise wraps one look-ahead before this can
            // happen. Behaviour is the old post-crossing wrap: stop the stale
            // look-ahead, wrap, re-emit from the seam. The overshoot is
            // measured through the map — the beats travelled past the seam,
            // re-entered at loopStart — which with a flat map is the same
            // modulo as before, and with a tempo change at the seam no longer
            // carries the overshoot at the loop-end tempo.
            lateWrap = true;

            const loopLength = current.loopEnd - current.loopStart;
            const seamAudioTime = now + secondsBetweenBeats(changes, newPosition, current.loopEnd, current.tempo);
            // #4784 — the wrap the device read maps back across for one
            // compensation window: for that long the audio a compensated track
            // is fed is still this dying pass's tail.
            schedulerSession.lastLoopSeamAudioTime = seamAudioTime;
            lateWrapSeamAudioTime = seamAudioTime;
            const wrappedPastSeam = beatAtSecondsFromAnchor(
                changes,
                current.loopStart,
                now - seamAudioTime,
                current.tempo
            );
            newPosition = current.loopStart + positiveModulo(wrappedPastSeam - current.loopStart, loopLength);
            advanceSchedulerDiscontinuityEpoch();
            rackDiscontinuity = true;
            // Anchor the next window at the seam itself. The gate is inclusive
            // at its lower bound, so `loopStart` exactly — nudging below it
            // would re-open the seam a second time.
            schedulerSession.lastScheduledBeat = current.loopStart;
            tickStartPosition = current.loopStart;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            // Stops notes, not pedals or controllers: drop the stored moves still
            // queued for the old position, as the edit teardown above does; the
            // window opening at the loop start restores what is in force there.
            discardStaleStoredMoves();
            // Fenced at the seam, each source by its own compensation: the
            // loop-end tail a compensated source is still due outlives the seam
            // instant (#4784). An uncompensated source is cut at the seam
            // unchanged.
            stopActiveSources(schedulerSession.activeAudioSources, ctx, seamAudioTime);
            schedulerSession.scheduledAudioClips.clear();
            schedulerSession.scheduledFrozenTracks.clear();
            schedulerSession.pendingSeam = null;
        } else if (insideLoopRegion && seamCapableRegion && horizonUpTo >= current.loopEnd) {
            // #4656 — scheduled seam: the look-ahead horizon reaches the seam
            // while the playhead is still short of it. Wrap the scheduling
            // window, not the playhead. The old code ran the horizon past
            // loopEnd, scheduled post-loop material, and only wrapped after
            // the overshoot — so the loop-start downbeat was requested up to
            // one grain behind the audio clock on every pass, and post-loop
            // sources were cut mid-sound at the wrap. Here the tick emits two
            // windows: the dying pass's remainder, clipped at loopEnd, and the
            // incoming pass's opening window at audio times continuing from
            // the seam instant — putting the downbeat ahead of the clock and
            // never scheduling anything past the seam.
            const seamAudioTime = now + secondsBetweenBeats(changes, newPosition, current.loopEnd, current.tempo);
            // The incoming pass's own position at `now`. Before the seam it is
            // negative-phase — the beat the incoming pass will have been at,
            // read backwards from loopStart — and the scheduling helpers turn
            // it into exact seam-continuing times: `now + seconds(
            // wrappedPositionNow → beat)` collapses to `seamAudioTime +
            // seconds(loopStart → beat)`. After the seam (stalled tick) it is
            // the ordinary overshoot position.
            const wrappedPositionNow = beatAtSecondsFromAnchor(
                changes,
                current.loopStart,
                now - seamAudioTime,
                current.tempo
            );
            // The same look-ahead the dying pass's window would have had,
            // continued into the incoming pass from the seam instant and
            // clipped at loopEnd. Longer ticks then re-detect the seam each
            // pass instead of scheduling across it.
            const horizonAudioTime = now + secondsBetweenBeats(changes, newPosition, horizonUpTo, current.tempo);
            const wrappedUpTo = Math.min(
                current.loopEnd,
                beatAtSecondsFromAnchor(changes, current.loopStart, horizonAudioTime - seamAudioTime, current.tempo)
            );

            advanceSchedulerDiscontinuityEpoch();
            rackDiscontinuity = true;
            tickStartPosition = current.loopStart;
            // The handover between the two windows happens between their
            // emissions below — the dying pass's events belong to the pass
            // that is ending and must be emitted against its own position and
            // its own dedup keys first. Only then are the sources fenced at
            // the seam instant, the dedup keys cleared for the incoming pass,
            // and the metronome re-anchored at loopStart.
            schedulerSession.pendingSeam = {
                seamAudioTime,
                anchorAudioTime: now,
                anchorPosition: newPosition,
            };
            // #4784 — recorded at detection, not when the instant arrives, so
            // the device read maps back across the region for exactly the
            // compensation window (the reader ignores it while the seam is
            // still ahead). A jump that supersedes this seam clears it below.
            schedulerSession.lastLoopSeamAudioTime = seamAudioTime;
            seam = {
                seamAudioTime,
                passPosition: newPosition,
                passHighWater: schedulerSession.lastScheduledBeat,
                passUpTo: current.loopEnd,
                wrappedUpTo,
            };
            newPosition = wrappedPositionNow;
        }

        const tracks = trackStore.value?.tracks ?? [];
        // On a scheduled-seam tick the audible transport is still finishing the
        // dying pass, so the follow-action scan covers its remaining advance —
        // the same window a non-seam tick would scan — rather than the incoming
        // pass's negative-phase position.
        const { jumpToPosition: rawJumpToPosition, shouldStop } = evaluateFollowActions(
            tracks,
            schedulerSession.accumulatedPosition,
            seam ? seam.passPosition : newPosition
        );
        const jumpToPosition = rawJumpToPosition;

        if (shouldStop) {
            schedulerSession.onStopRequested?.();
            return;
        }

        if (jumpToPosition !== null) {
            // The relocation supersedes the seam this tick may have scheduled.
            seam = null;
            schedulerSession.pendingSeam = null;
            // And the wrap it was to pivot on never happened — the fence below
            // is the teardown semantic, so the device read must not map back
            // across a region on the strength of this record (#4784).
            schedulerSession.lastLoopSeamAudioTime = null;
            newPosition = jumpToPosition;
            advanceSchedulerDiscontinuityEpoch();
            rackDiscontinuity = true;
            schedulerSession.lastScheduledBeat = newPosition;
            tickStartPosition = newPosition;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            // Stops notes, not pedals or controllers: drop the stored moves still
            // queued for the old position, as the edit teardown above does; the
            // window opening at the destination restores what is in force there.
            discardStaleStoredMoves();
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

        // The audio-clock instant the published position is for — sampled at
        // this tick's start, so the anchor stays exact even though the commit
        // lands after the awaits above. `captureGestureBeat` projects from this
        // pair, which is why it must be published with the position and never
        // on its own.
        //
        // A scheduled seam publishes the audible position, not the scheduler's
        // integration: on the seam tick itself the dying pass is still what
        // sounds, and until the seam instant arrives the incoming pass's
        // position is negative-phase — before loopStart — which no reader may
        // see. The published clock follows the dying pass through that window,
        // integrated from where the seam tick saw it and clamped at loopEnd —
        // always a valid positive-phase position — and resumes the map-exact
        // position at the seam. Scheduling decisions — punch, follow actions,
        // the windows themselves — stay on `newPosition` above: they are about
        // material *this* scheduler emitted, against its own clock (ADR 0039).
        if (schedulerSession.pendingSeam !== null && now >= schedulerSession.pendingSeam.seamAudioTime) {
            schedulerSession.pendingSeam = null;
            // The seam instant has passed: the pass the published clock has
            // shown until now ended, and `publishedBeat` below is the first
            // wrapped one. Counting here — not at the look-ahead seam
            // detection — keeps the count on the same page as the cursor a
            // reader sees beside it.
            playheadWrapCountRef.current += 1;
        }
        let publishedBeat = newPosition;
        if (seam) {
            publishedBeat = seam.passPosition;
        } else if (schedulerSession.pendingSeam !== null) {
            // Still-future seam: the incoming pass's integration is negative
            // phase until the seam instant arrives, so publish the dying
            // pass's continued position instead.
            publishedBeat = Math.min(
                current.loopEnd,
                beatAtSecondsFromAnchor(
                    changes,
                    schedulerSession.pendingSeam.anchorPosition,
                    now - schedulerSession.pendingSeam.anchorAudioTime,
                    current.tempo
                )
            );
        }
        playheadClockRef.beat = publishedBeat;
        playheadClockRef.audioTimeSeconds = now;
        // The cursor follows the transport that is producing the sound. While
        // the native engine is that transport it reports where it actually
        // rendered to — loop wraps included — and this integration is only the
        // scheduling clock; the rest of the time there is no engine reading and
        // the two are the same number.
        playheadPositionRef.current = readNativeEngineCursorBeats() ?? publishedBeat;
        // A late wrap (or the seam-edit re-anchor) commits its wrapped position
        // this tick, so the published beat above is the first wrapped one and
        // the wrap count moves with it. The scheduled seam counts where its
        // instant arrives instead — see the pendingSeam clear above.
        if (lateWrap) {
            playheadWrapCountRef.current += 1;
        }

        // Sync to AudioEngine for real-time DSP (SAB-backed).
        //
        // The beat goes over with the seconds it maps to. A worklet cannot
        // integrate the tempo map — it does not have one — so publishing only
        // the beat and the tempo in force leaves every seconds-domain reader
        // dividing one by the other, which is the flat conversion that drifts
        // across a tempo change.
        audioEngine.setTransportInfo(
            publishedBeat,
            secondsBetweenBeats(changes, 0, publishedBeat, current.tempo),
            currentTempo,
            current.isPlaying,
            current.loopStart,
            current.loopEnd,
            current.isLooping
        );

        const hasArmedTracks = trackStore.value?.tracks.some((time) => time.armed) ?? false;
        // On a scheduled-seam tick the audible transport is still finishing the
        // dying pass, so the punch checks scan its position — the same window a
        // non-seam tick would scan — rather than the incoming pass's
        // negative-phase position. And because no later tick ever revisits the
        // dying pass's last look-ahead band, a punch-out the dying pass reaches
        // before the seam instant is due at the seam instant itself.
        const punchScanBeat = seam ? seam.passPosition : newPosition;
        const punchScanWindowStart = seam ? dyingTickStartPosition : tickStartPosition;
        // The punch checks below may open a recording this tick, so read the
        // recording state BEFORE that block runs. A punch-out is due at the seam
        // only for a recording that was already open when the tick began — the
        // same law that keeps an ordinary tick from opening and finalizing a
        // punch in one pass, where the scan beat cannot be both inside the
        // region and past its end. Ungated, a punch-in whose crossing lands on
        // the seam tick was finalized empty in the same tick, every pass.
        const recordingOpenAtTickStart = schedulerSession.punchRecordingActive;
        const punchOutDueAtSeam = seam !== null && recordingOpenAtTickStart && current.punchOutBeat <= seam.passUpTo;
        // #4905 — on a wrap tick (the seam-edit re-anchor or the late wrap) the
        // scanned position is already the incoming pass's, and a region at or
        // below the look-ahead never presents a scan at or past the punch-out
        // beat afterwards: the crossing of the punch-out point happened inside
        // the pass that just died, so the punch-out is due at the wrap itself.
        // Same gating law as the seam arm — only for a recording already open
        // when the tick began, so a punch-in opened this tick is never
        // finalized empty.
        const punchOutDueAtWrap = lateWrap && recordingOpenAtTickStart && current.punchOutBeat <= current.loopEnd;
        if (
            current.punchInEnabled &&
            !current.isRecording &&
            !schedulerSession.punchRecordingActive &&
            hasArmedTracks &&
            current.punchInBeat < current.punchOutBeat &&
            punchScanBeat >= current.punchInBeat &&
            // Upper bound. Without it, starting playback past the region fires
            // punch-in and punch-out on the same tick: a full-width clip and
            // take are stamped across [punchInBeat, punchOutBeat) and captured
            // nothing. Punching in only makes sense while the region is still
            // ahead of the tick's end.
            punchScanBeat < current.punchOutBeat
        ) {
            schedulerSession.punchRecordingActive = true;
            // Anchor the punched clip where capture actually begins. The tick is
            // already up to one grain past the region start when the crossing is
            // detected, so `punchInBeat` is the right anchor when the transport
            // rolled across it during this tick. When playback *started* inside
            // the region the capture begins at the entry beat instead, and
            // anchoring at `punchInBeat` would displace the take backwards by
            // the whole distance already covered, leaving the tail silent.
            // `punchScanWindowStart` is the scanned pass's own window opening
            // beat, so the max of the two is the first beat this recording can
            // contain. `startRecording`'s default (the transport store's
            // playhead) is wrong on both paths — nothing writes it during
            // playback.
            const punchAnchorBeat = Math.max(current.punchInBeat, punchScanWindowStart);
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
                    const captureAnchor = recClip && {
                        provisionalStartBeat: recClip.startBeat,
                        songSeconds: secondsBetweenBeats(changes, 0, playheadClockRef.beat, current.tempo),
                        contextSeconds: playheadClockRef.audioTimeSeconds,
                        latencySeconds:
                            (ctx.baseLatency || 0) + (ctx.outputLatency || 0) + getCompensationDelay(track.id),
                    };
                    Promise.resolve(
                        startAudioRecording(
                            track.id,
                            (result) => {
                                if (result.kind === 'failed') {
                                    // A capture that dies mid-punch (ring overrun,
                                    // worker crash, a WAV that never decoded) must
                                    // not strand an empty provisional clip on the
                                    // arrangement or stay silent about it (#4265).
                                    notifyUser('Punch-in recording failed — the partial take was discarded.', 'error');
                                    if (recClip) {
                                        discardRecording(recClip.id);
                                    }
                                    return;
                                }
                                const { buffer } = result;
                                const bufferId = `rec-${crypto.randomUUID()}`;
                                cacheAudioBuffer({ buffer, bufferId });
                                if (recClip && captureAnchor) {
                                    // The punched clip is finalized by the punch-out
                                    // `stopRecording`, so the commit carries the live
                                    // clip with only its media reference attached —
                                    // and it is the recording's single history entry.
                                    const liveClip = trackStore.value?.tracks
                                        .flatMap((time) => time.clips)
                                        .find((clip) => clip.id === recClip.id);
                                    const finalizedClip = liveClip ?? recClip;
                                    const recordedClip = { ...finalizedClip, audioBufferId: bufferId };
                                    // Sample zero belongs to the producer's clock.
                                    // The callback can arrive after a wrap, tempo
                                    // edit, or stop has replaced the published pair.
                                    const capture = {
                                        provisionalStartBeat: captureAnchor.provisionalStartBeat,
                                        sourceContextOriginSeconds:
                                            result.sampleZeroContextFrame / result.sampleRate -
                                            captureAnchor.latencySeconds,
                                        mediaOriginSeconds:
                                            captureAnchor.songSeconds +
                                            result.sampleZeroContextFrame / result.sampleRate -
                                            captureAnchor.contextSeconds -
                                            captureAnchor.latencySeconds,
                                    };
                                    // The user-facing stop awaits this through the
                                    // lifecycle; the scheduler itself never blocks on
                                    // it. A failed commit retires the provisional
                                    // result rather than leaving it with no entry,
                                    // and says so the way the punch capture-failure
                                    // sibling does.
                                    recordingLifecycle.trackCommit(
                                        commitRecording(recordedClip, capture).catch((error: unknown) => {
                                            logger.error(
                                                new Error('Punch-in recording commit failed', { cause: error })
                                            );
                                            notifyUser(
                                                'Punch-in recording failed — the take was discarded. Try recording again.',
                                                'error'
                                            );
                                            discardRecording(recordedClip.id);
                                        })
                                    );
                                }
                            },
                            track.inputId
                        )
                    ).catch((error: unknown) => {
                        logger.error(new Error('Punch-in audio recording failed to start', { cause: error }));
                    });
                }
            }
        }

        // `punchOutDueAtSeam`: the punch-out point sits inside the dying pass's
        // last look-ahead band — above where it stands at the seam tick but at
        // or below where the seam instant lands it. The crossing will happen
        // before the seam and no later tick scans that band, so the punch-out
        // is due at the seam instant and fires here.
        if (
            schedulerSession.punchRecordingActive &&
            current.punchInEnabled &&
            (punchScanBeat >= current.punchOutBeat || punchOutDueAtSeam || punchOutDueAtWrap)
        ) {
            // Finalize BEFORE the flush. The flush runs the capture terminal that
            // commits the take, and the commit captures the live clip and takes;
            // running it first would capture the pre-finalization anchor — a
            // zero-length clip and take. `stopRecording` writes its finalization
            // synchronously and its returned promise is only the MIDI commit, so
            // this neither blocks the scheduler nor reorders the audio flush.
            // Same anchoring as punch-in: the region's own end beat, not the
            // overshooting tick position and not the stale store playhead.
            finalizeAutomaticRecording(current.punchOutBeat);
            await Promise.resolve(stopAudioRecording()).catch((error: unknown) => {
                logger.error(new Error('Punch-out audio recording failed to stop', { cause: error }));
            });
            if (!cancellation.isCurrent()) {
                return;
            }
            schedulerSession.punchRecordingActive = false;
            updateTransportState({ isRecording: false });
        }

        if (seam) {
            // Staged here rather than in the detection branch, after the punch
            // checks above: a punch-out due at the seam instant finalizes its
            // recording this tick, and a take staged before that finalization
            // would name the punch clip with a full pass span it never
            // recorded. A recording that continues across the seam — no punch
            // out, or a punch-out past the loop end — still gets its pass-span
            // take here, so the staging moment moves but the staged takes do
            // not.
            stageLoopWrapTakes(current, seam.seamAudioTime);
            // Dying pass: the window remainder up to the seam, emitted against
            // the position the dying pass holds at `now`, so its last events
            // land at their own grid times — all at or before the seam instant.
            scheduleMetronome(seam.passHighWater, seam.passUpTo, seam.passPosition, current);
            await scheduleMidiNotes(
                seam.passHighWater,
                seam.passUpTo,
                seam.passPosition,
                schedulerSession.scheduledFrozenTracks,
                schedulerSession.activeAudioSources,
                current,
                currentTempo,
                cancellation,
                // Only an edit's re-emit makes this window a relocation (it opens
                // where the cut look-ahead began); an ordinary seam tick continues.
                reemitAfterEdit
            );
            if (!cancellation.isCurrent()) {
                return;
            }
            // Audio clips read their window end inclusively, so shave one beat
            // epsilon: a clip sitting exactly on loopEnd is post-loopEnd
            // material and must not be started by the dying pass — the seam
            // instant it would start at is the instant the incoming pass's own
            // events are due.
            scheduleAudioClips(
                seam.passHighWater,
                seam.passUpTo - BEAT_EPSILON,
                seam.passPosition,
                schedulerSession.scheduledAudioClips,
                schedulerSession.scheduledFrozenTracks,
                schedulerSession.activeAudioSources,
                current
            );
            // Incoming pass: the window past the seam, emitted against the
            // incoming pass's own position at `now`, so its first beat lands
            // exactly at the seam instant — ahead of the audio clock on every
            // non-stalled pass, and sample-accurate through the tempo map.
            // Before it runs, the handover between the two windows:
            //
            // The fence and the dedup clears sit here, not in the detection
            // branch, because the dying window's emission above is material
            // still to play — its events land at or before the seam instant —
            // and it must run against the dying pass's OWN dedup keys. Only
            // the incoming window may repopulate those keys: cleared one tick
            // early, the dying window's calls re-schedule the frozen tracks
            // and the clips spanning the seam at the dying position — an
            // immediate mid-buffer duplicate layered over its own fenced
            // source, whose key then blocks the incoming pass from ever
            // re-anchoring them. Sources sounding across the seam are cut at
            // the seam instant itself, not one grain late — each by its own
            // compensation (#4784): a compensated source's loop-end tail is
            // still due for that long past the seam, and the incoming pass's
            // window holds until it is done.
            stopActiveSources(schedulerSession.activeAudioSources, ctx, seam.seamAudioTime);
            schedulerSession.scheduledAudioClips.clear();
            schedulerSession.scheduledFrozenTracks.clear();
            // The dying window's emission walked the metronome's beat up to
            // loopEnd, and `scheduleMetronome` gates on `lastBeat` before its
            // time-keyed dedup — left standing, that gate would swallow every
            // incoming-pass click, because the loopEnd beat outranks every
            // beat the new pass offers. Re-open the window at loopStart; the
            // `firedClickTimes` dedup (deliberately kept alive by
            // `resetMetronomeBeat`) then merges the seam pair — the dying
            // loopEnd click and the incoming loopStart click are the same
            // physical instant.
            resetMetronomeBeat(current.loopStart);
            scheduleMetronome(current.loopStart, seam.wrappedUpTo, newPosition, current);
            // The incoming pass opens at the loop start: a relocation, so the
            // stored controllers are restored to what is in force there. The
            // dying window above already posted everything up to the seam, which
            // is why this path lifts nothing frameless.
            await scheduleMidiNotes(
                current.loopStart,
                seam.wrappedUpTo,
                newPosition,
                schedulerSession.scheduledFrozenTracks,
                schedulerSession.activeAudioSources,
                current,
                currentTempo,
                cancellation,
                true
            );
            if (!cancellation.isCurrent()) {
                return;
            }
            scheduleAudioClips(
                current.loopStart,
                seam.wrappedUpTo,
                newPosition,
                schedulerSession.scheduledAudioClips,
                schedulerSession.scheduledFrozenTracks,
                schedulerSession.activeAudioSources,
                current
            );
            schedulerSession.lastScheduledBeat = seam.wrappedUpTo;
        } else {
            // #4905 — a wrap tick's pass-span takes are staged here rather
            // than in the detection branches, after the punch checks above, on
            // the same law as the seam path: a punch-out due at the wrap
            // finalizes its recording this tick, and a take staged before that
            // finalization would name the punch clip with a full pass span it
            // never recorded.
            if (lateWrap && lateWrapSeamAudioTime !== null) {
                stageLoopWrapTakes(current, lateWrapSeamAudioTime);
            }
            // The window opens at the committed position — after any follow
            // action relocation — exactly as the pre-seam code emitted it.
            const scheduleUpTo = newPosition + lookAheadBeats;
            scheduleMetronome(
                schedulerSession.lastScheduledBeat,
                scheduleUpTo,
                schedulerSession.accumulatedPosition,
                current
            );
            // A late wrap, a follow-action jump and an edit's re-emit open this
            // window at their destination, so it restores the stored controllers
            // there too.
            await scheduleMidiNotes(
                schedulerSession.lastScheduledBeat,
                scheduleUpTo,
                schedulerSession.accumulatedPosition,
                schedulerSession.scheduledFrozenTracks,
                schedulerSession.activeAudioSources,
                current,
                currentTempo,
                cancellation,
                lateWrap || jumpToPosition !== null || reemitAfterEdit
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
            schedulerSession.lastScheduledBeat = scheduleUpTo;
        }
        // applyAutomation runs first and returns the tracks whose fader gain it
        // composed (VCA multiplier folded in); applyVcaGains then drives only the
        // VCA-member tracks it did NOT write, so the two never race the fader.
        // These appliers drive what is audible, so they follow the published
        // clock — the dying pass on a seam tick and while the seam is still
        // pending — not the scheduler's negative-phase integration.
        const gainAutomatedTrackIds = applyAutomation(publishedBeat);
        applyVcaGains(gainAutomatedTrackIds);
        // FX-5 — same per-tick recompute discipline applyAutomation uses for its
        // compensation: a latency change anywhere (native plugin push, device
        // added/removed/bypassed) moves the sidechain key alignment within one
        // grain instead of holding a stale value for the rest of the session.
        refreshSidechainAlignment();
        applyModulation(publishedBeat);
        // Hand modulation the values applyAutomation just applied, so a
        // param both automated and modulated combines onto the value the engine
        // actually holds rather than a separately recomputed raw curve value.
        // deviceReadBeatByTrack keeps indexAutomatedBases's clip gate and curve
        // read on the same compensated clock applyAutomation used for its own
        // device-family lanes this tick (#4684).
        applyModulationToEngine(
            publishedBeat,
            schedulerSession.discontinuityEpoch,
            appliedAutomationBases,
            deviceReadBeatByTrack
        );
        scheduleAdjustmentLayers(publishedBeat);
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
