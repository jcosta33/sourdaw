/**
 * Open a pass of live automation over the span the session is playing
 * (#3068, D3.c.4b).
 *
 * ── Where a pass begins, and why a loop is two spans ──────────────────────
 *
 * A pass always begins at the playhead. The engine's queue is a window the
 * audio thread walks forward through, and `RampedParam` resolves every stamp
 * the walk has already passed in the block it first sees them — so a span that
 * began behind the playhead would not replay the past, it would collapse it
 * into one block and sweep the fader through the whole of it at once.
 *
 * A loop region is therefore not by itself the span. `Scheduler::frames_until_loop_end`
 * wraps only a playhead already below the region's end, so playing from inside
 * a loop runs entry-to-end once and the region entire from then on, and playing
 * from at or past the end never wraps at all and is an ordinary pass to the end
 * of the programme. Both spans are read here, at arm: the seam arrives on an
 * animation frame, and a tick that has writes to send is no place to run a
 * projection over the stores.
 *
 * ── Clipping the seam, once ───────────────────────────────────────────────
 *
 * A ramp is never split, so a looped span drops a write still gliding at the
 * loop end rather than sending a trajectory the wrap will cancel mid-flight.
 * A write *stamped* at the end is dropped with it: the engine renders frames
 * strictly below a wrapping span's end and the wrap is not a locate, so the
 * playhead never walks past such a stamp and its queue slot is never released
 * — resent once per pass, it fills the lane's queue with dead copies of
 * itself. That is a property of the span, not of a moment in it, so it is
 * applied here — where the span is fixed for the life of the pass — instead
 * of being re-decided on every pump against numbers that cannot have changed.
 *
 * ── Why it does not await its own first pump ──────────────────────────────
 *
 * Every caller runs inside the session's serialised command chain, and the
 * pump queues on that same chain. Awaiting it here would wait for the work
 * that is currently running to finish, which is this work.
 */

import { logger } from '#/infra/logger/appLogger';
import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphParameterWrite } from '../../models/AudioGraphBackend';

import { carryQueuedStamps } from './carryQueuedStamps';
import {
    nativeLiveAutomationWriter,
    writeStartSeconds,
    type LiveAutomationWriterTarget,
} from './nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { pumpNativeLiveAutomationWriter } from './pumpNativeLiveAutomationWriter';
import { readLiveAutomationWrites } from './readLiveAutomationWrites';

export type ArmNativeLiveAutomationWriterInput = Readonly<{
    /** The strips the session's topology built — the only ones a write may address. */
    stripTracks: readonly Track[];
    /** The frame grid this session's programme is placed on. */
    sampleRate: number;
    /** Where the session's programme ends, on the engine clock. */
    programmeEndSeconds: number;
    /** Where this pass begins, on the engine clock. */
    positionSeconds: number;
    /**
     * The engine fence number reported by the command that put the transport
     * here — the locate, the roll, or the maps install this arm follows — or
     * `null` when that command reported none. See
     * {@link LiveAutomationWriterPass.provenAfterBatch}.
     */
    provenAfterBatch: number | null;
    /**
     * Whether this arm was preceded by a locate command that pruned stamps at or past
     * this position in the engine ledger (`QueueBudgets::apply_seek`).
     */
    seek?: boolean;
}>;

/** One stretch of the engine clock a pass sends writes for. */
type PassSpan = Readonly<{ startSeconds: number; endSeconds: number; clipsAtEnd: boolean }>;

type PassSpans = Readonly<{ entry: PassSpan; loop: PassSpan | null }>;

function passSpans(input: ArmNativeLiveAutomationWriterInput): PassSpans {
    const { loopRegion, loopEnabled } = nativeLiveGraphSession;
    const wraps = loopEnabled && loopRegion !== null && input.positionSeconds < loopRegion.endSeconds;
    if (!wraps || !loopRegion) {
        return {
            entry: {
                startSeconds: input.positionSeconds,
                endSeconds: input.programmeEndSeconds,
                clipsAtEnd: false,
            },
            loop: null,
        };
    }
    return {
        entry: { startSeconds: input.positionSeconds, endSeconds: loopRegion.endSeconds, clipsAtEnd: true },
        loop: { startSeconds: loopRegion.startSeconds, endSeconds: loopRegion.endSeconds, clipsAtEnd: true },
    };
}

/** Where a write's value arrives: a ramp's landing, any other shape's own stamp. */
function writeLandSeconds(write: AudioGraphParameterWrite): number {
    if (write.shape === 'ramp-to') {
        return write.landTime;
    }
    return write.time;
}

/** `seconds_to_frames` in `graph.rs`, which is what every stamp is compared as. */
function secondsToFrames(seconds: number, sampleRate: number): number {
    return Math.round(seconds * sampleRate);
}

function orderedWrites(
    writes: readonly AudioGraphParameterWrite[],
    span: PassSpan,
    sampleRate: number
): readonly AudioGraphParameterWrite[] {
    const ordered = [...writes].sort((left, right) => writeStartSeconds(left) - writeStartSeconds(right));
    if (!span.clipsAtEnd) {
        return ordered;
    }
    // The release proof walks frames (`proven_popped`), so the start clip is
    // taken on the frame the stamp rounds onto: a write starting at or past
    // the end frame is one the engine can never walk past while it wraps.
    const endFrame = secondsToFrames(span.endSeconds, sampleRate);
    return ordered.filter(
        (write) =>
            secondsToFrames(writeStartSeconds(write), sampleRate) < endFrame &&
            writeLandSeconds(write) <= span.endSeconds
    );
}

type SpanTargets = Readonly<{ targets: LiveAutomationWriterTarget[]; exclusions: readonly string[] }>;

function readSpan(input: ArmNativeLiveAutomationWriterInput, span: PassSpan): SpanTargets {
    const { entries, exclusions } = readLiveAutomationWrites({
        stripTracks: input.stripTracks,
        sampleRate: input.sampleRate,
        regionStartSeconds: span.startSeconds,
        regionEndSeconds: span.endSeconds,
    });
    const targets = entries
        .map((entry): LiveAutomationWriterTarget => {
            return {
                target: entry.target,
                writes: orderedWrites(entry.writes, span, input.sampleRate),
                cursor: 0,
                queued: [],
            };
        })
        .filter((slot) => slot.writes.length > 0);
    const reported = exclusions.map(
        (exclusion) =>
            `[AudioEngine] live automation excluded ${exclusion.subjectId} on strip ` +
            `${exclusion.stripId}: ${exclusion.reason}`
    );
    return { targets, exclusions: reported };
}

/**
 * The producer drops what it cannot carry so one lane cannot silence a strip,
 * but a drop nobody says out loud is a fader that stops moving with no account
 * of why. Said once per set rather than once per arm: every locate and every
 * loop edit re-arms, and repeating an unchanged list is noise that buries the
 * change when the set does move.
 */
function reportExclusions(exclusions: readonly string[]): void {
    const signature = exclusions.join('\n');
    if (signature === nativeLiveAutomationWriter.reportedExclusions) {
        return;
    }
    nativeLiveAutomationWriter.reportedExclusions = signature;
    for (const exclusion of exclusions) {
        logger.warn(exclusion);
    }
}

export function armNativeLiveAutomationWriter(input: ArmNativeLiveAutomationWriterInput): void {
    const spans = passSpans(input);
    const entry = readSpan(input, spans.entry);
    const loop = spans.loop ? readSpan(input, spans.loop) : null;
    reportExclusions(entry.exclusions);

    const previousPass = nativeLiveAutomationWriter.pass;
    if (previousPass !== null) {
        const seekFrame = input.seek ? secondsToFrames(input.positionSeconds, input.sampleRate) : null;
        carryQueuedStamps(previousPass.targets, entry.targets, seekFrame);
    }

    nativeLiveAutomationWriter.epoch += 1;
    nativeLiveAutomationWriter.pass = {
        stripTracks: input.stripTracks,
        sampleRate: input.sampleRate,
        programmeEndSeconds: input.programmeEndSeconds,
        entrySeconds: input.positionSeconds,
        provenAfterBatch: input.provenAfterBatch,
        looping: loop !== null,
        targets: entry.targets,
        loopTargets: loop?.targets ?? null,
        lastLoopWraps: null,
        // The floor every wrap's `last_wrap_frame` provably passes: the loop
        // end frame, which `advance_playhead`'s `next >= end` bounds it below
        // by. `null` when nothing wraps, which silences the seam half.
        wrapFloorFrame: spans.loop ? secondsToFrames(spans.loop.endSeconds, input.sampleRate) : null,
        queueFullReported: false,
    };

    void pumpNativeLiveAutomationWriter({
        positionSeconds: input.positionSeconds,
        loopWraps: null,
        batchesApplied: null,
        writerEpoch: nativeLiveAutomationWriter.epoch,
    });
}
