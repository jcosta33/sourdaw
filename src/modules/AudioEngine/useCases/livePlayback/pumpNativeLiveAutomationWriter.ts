/**
 * Push the next slice of the pass's automation at the engine (#3068, D3.c.4b).
 *
 * Driven by the playhead feed's own progress tick, which is the cadence
 * `crates/sourdaw-native/src/commands/graph.rs` names when it assigns the
 * per-pass re-arm to the automation owner: this side holds the curve, learns
 * the loop region, and already polls the position on a cadence it can send
 * from. The engine's queue holds a window rather than a curve, so a pass
 * consumes what it walks past and the loop seam does not put it back.
 *
 * ── One batch at a time, and cursors only on acceptance ───────────────────
 *
 * A cursor is a claim that the engine accepted those writes. A batch the
 * engine refuses — the queue ledger is full, or the graph moved under it —
 * changes nothing at all, so the identical batch goes out again on the next
 * tick rather than a shorter one that skipped past what never landed. That
 * makes an unanswered round trip dangerous in exactly one way: a second pump
 * issued behind it would send the same writes a second time and charge the
 * queue twice for them. Hence the in-flight claim, keyed by epoch so a pass
 * that has ended cannot hold the next one's first pump back.
 *
 * ── How much a pump may send ──────────────────────────────────────────────
 *
 * As much as the engine's ledger will take, which is the capacity minus what
 * that ledger still believes is queued. The mirror follows `graph.rs` exactly:
 * a stamp releases when the echoed playhead has passed its *start* frame
 * (`proven_popped`), and a write that is not a step first cancels every queued
 * stamp landing at or after its own start (`charge_automation`'s stale drop,
 * mirroring `RampedParam::cancel_stale`). Both are applied against the same
 * snapshot that windows the pump, so what is sent is what the engine can hold.
 */

import { logger } from '#/infra/logger/appLogger';

import { type AudioGraphApplyResult, type AudioGraphParameterWrite } from '../../models/AudioGraphBackend';

import {
    AUTOMATION_QUEUE_CAPACITY,
    AUTOMATION_QUEUE_MARGIN,
    AUTOMATION_WINDOW_SECONDS,
    nativeLiveAutomationWriter,
    writeStartSeconds,
    type LiveAutomationQueuedStamp,
    type LiveAutomationWriterPass,
    type LiveAutomationWriterTarget,
} from './nativeLiveAutomationWriterState';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

export type PumpNativeLiveAutomationWriterInput = Readonly<{
    /** The engine's own clock, as of the snapshot this pump answers. */
    positionSeconds: number;
    /**
     * The engine's cumulative loop-wrap count, or `null` when the caller holds
     * no snapshot — the arm's own first pump, which runs before the feed has
     * read the engine even once.
     */
    loopWraps: number | null;
    /** The pass this snapshot was read for. A pump never crosses passes. */
    writerEpoch: number;
}>;

/** One target's share of one batch, and what accepting it would queue. */
type Admission = Readonly<{
    slot: LiveAutomationWriterTarget;
    writes: readonly AudioGraphParameterWrite[];
    queued: readonly LiveAutomationQueuedStamp[];
}>;

/** `seconds_to_frames` in `graph.rs`, which is what every stamp is compared as. */
function frameAt(seconds: number, sampleRate: number): number {
    return Math.round(seconds * sampleRate);
}

function stampOf(write: AudioGraphParameterWrite, sampleRate: number): LiveAutomationQueuedStamp {
    if (write.shape === 'ramp-to') {
        return { startFrame: frameAt(write.startTime, sampleRate), landFrame: frameAt(write.landTime, sampleRate) };
    }
    const frame = frameAt(write.time, sampleRate);
    return { startFrame: frame, landFrame: frame };
}

/** A step appends; every other shape this writer carries cancels the stale first. */
function cancelsStale(write: AudioGraphParameterWrite): boolean {
    return write.shape !== 'step';
}

/**
 * Take the seam, when the pass can tell one closed.
 *
 * The engine walked the pass's writes out of its queue on the way to the loop
 * end and wrapping does not put them back, so every pass after the first is
 * sent the region entire. This is the per-pass re-arm `graph.rs` leaves to this
 * owner.
 *
 * The wrap counter answers that question from the second snapshot on. It cannot
 * answer the first, because it counts wraps since the engine's scheduler was
 * built rather than since this pass armed — so for that one snapshot the
 * playhead answers instead: a position behind where the pass began can only be
 * a region the engine took the musician back to.
 */
function takeLoopSeam(input: { pass: LiveAutomationWriterPass; positionSeconds: number; loopWraps: number | null }) {
    const { pass, positionSeconds, loopWraps } = input;
    if (loopWraps === null) {
        return;
    }
    const seamClosed =
        pass.lastLoopWraps === null
            ? pass.looping && positionSeconds < pass.entrySeconds
            : loopWraps !== pass.lastLoopWraps;
    pass.lastLoopWraps = loopWraps;
    if (!seamClosed || !pass.loopTargets) {
        return;
    }
    // The engine's ledger does not forget at a seam — its own release proof
    // needs a whole further pass — so what the outgoing span queued is carried
    // onto the incoming one rather than dropped. It drains from there as this
    // pass walks the same frames again.
    carryQueuedStamps(pass.targets, pass.loopTargets);
    pass.targets = pass.loopTargets;
    for (const slot of pass.targets) {
        slot.cursor = 0;
    }
}

/** The identity the engine addresses a queue by: the whole target, spelled out. */
function targetKey(slot: LiveAutomationWriterTarget): string {
    const { target } = slot;
    if (target.kind === 'track-send-level') {
        return `${target.kind}:${target.trackId}:${target.busId}`;
    }
    return `${target.kind}:${target.trackId}`;
}

function carryQueuedStamps(
    from: readonly LiveAutomationWriterTarget[],
    to: readonly LiveAutomationWriterTarget[]
): void {
    if (from === to) {
        return;
    }
    const outgoing = new Map(from.map((slot): [string, LiveAutomationWriterTarget] => [targetKey(slot), slot]));
    for (const slot of to) {
        slot.queued = outgoing.get(targetKey(slot))?.queued ?? [];
    }
}

/** Drop what the echoed playhead proves the engine popped (`proven_popped`). */
function releaseLanded(pass: LiveAutomationWriterPass, positionSeconds: number): void {
    const playheadFrame = frameAt(positionSeconds, pass.sampleRate);
    for (const slot of pass.targets) {
        slot.queued = slot.queued.filter((stamp) => stamp.startFrame >= playheadFrame);
    }
}

/**
 * The writes each target owes inside the lookahead, in curve order.
 *
 * A ramp is admitted on its start, never on its landing, and never split: the
 * engine re-anchors it at the value the parameter holds at that start frame,
 * so the whole trajectory is one write or it is not that trajectory.
 */
function admitWindow(input: { pass: LiveAutomationWriterPass; positionSeconds: number }): readonly Admission[] {
    const { pass } = input;
    const horizon = input.positionSeconds + AUTOMATION_WINDOW_SECONDS;
    const ceiling = AUTOMATION_QUEUE_CAPACITY - AUTOMATION_QUEUE_MARGIN;
    const admissions: Admission[] = [];
    for (const slot of pass.targets) {
        const writes: AudioGraphParameterWrite[] = [];
        let queued = slot.queued;
        for (const write of slot.writes.slice(slot.cursor)) {
            if (writeStartSeconds(write) >= horizon) {
                break;
            }
            const stamp = stampOf(write, pass.sampleRate);
            const surviving = cancelsStale(write)
                ? queued.filter((pending) => pending.landFrame < stamp.startFrame)
                : queued;
            if (surviving.length >= ceiling) {
                break;
            }
            queued = [...surviving, stamp];
            writes.push(write);
        }
        if (writes.length > 0) {
            admissions.push({ slot, writes, queued });
        }
    }
    return admissions;
}

function reportRefusal(pass: LiveAutomationWriterPass, reason: string): void {
    const queueFull = reason.includes('automation-queue-capacity');
    if (queueFull && pass.queueFullReported) {
        return;
    }
    pass.queueFullReported = pass.queueFullReported || queueFull;
    logger.warn(`[AudioEngine] live automation batch refused: ${reason}`);
}

export async function pumpNativeLiveAutomationWriter(input: PumpNativeLiveAutomationWriterInput): Promise<void> {
    const pass = nativeLiveAutomationWriter.pass;
    const backend = nativeLiveGraphSession.backend;
    const epoch = nativeLiveAutomationWriter.epoch;
    if (!pass || !backend || input.writerEpoch !== epoch) {
        return;
    }
    if (nativeLiveAutomationWriter.inFlightEpoch === epoch) {
        return;
    }

    takeLoopSeam({ pass, positionSeconds: input.positionSeconds, loopWraps: input.loopWraps });
    releaseLanded(pass, input.positionSeconds);

    const admissions = admitWindow({ pass, positionSeconds: input.positionSeconds });
    if (admissions.length === 0) {
        return;
    }

    nativeLiveAutomationWriter.inFlightEpoch = epoch;
    try {
        // Queued on the session's own chain, like every other command that
        // shares this engine: a pump must not overtake the locate or the park
        // that decides what the engine still holds.
        const result = await queueOnNativeLiveGraphSession(async (): Promise<AudioGraphApplyResult | null> => {
            // The pass can end while this work waits its turn — a seek
            // queued ahead of it re-arms, and these writes then describe a
            // region the engine has already been moved out of.
            if (nativeLiveAutomationWriter.epoch !== epoch) {
                return null;
            }
            return backend.apply({
                schemaVersion: 1,
                commands: admissions.flatMap(({ slot, writes }) =>
                    writes.map((write) => ({ kind: 'write-parameter' as const, target: slot.target, write }))
                ),
            });
        });
        if (result === null || nativeLiveAutomationWriter.epoch !== epoch) {
            return;
        }
        if (result.application !== 'applied') {
            // Nothing moves. The engine took none of it — a refusal is
            // whole-batch, before anything is pushed — so the next tick offers
            // the same writes again rather than stepping over them.
            reportRefusal(pass, result.reason);
            return;
        }
        for (const { slot, writes, queued } of admissions) {
            slot.cursor += writes.length;
            slot.queued = [...queued];
        }
    } catch (error) {
        // A thrown apply is a bridge fault, not a decision about the writes:
        // the cursors stay where they are and the next tick tries again.
        logger.warn('[AudioEngine] live automation batch failed:', error);
    } finally {
        // Release only what this pump claimed; a newer pass may already hold
        // the claim, and clearing that would let its next tick stack a second
        // batch behind its own.
        if (nativeLiveAutomationWriter.inFlightEpoch === epoch) {
            nativeLiveAutomationWriter.inFlightEpoch = null;
        }
    }
}
