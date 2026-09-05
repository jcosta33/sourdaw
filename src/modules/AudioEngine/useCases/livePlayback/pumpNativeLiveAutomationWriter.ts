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
 * a stamp releases when the echoed playhead has passed its *start* frame, or —
 * the seam half of `proven_popped`, for the stamps a loop's pinned playhead
 * never passes — once `SEAMS_PROVING_A_WHOLE_PASS` seams have closed since the
 * wrap count the stamp anchored at and its start frame is below the frame the
 * last wrap walked to, and a write that is not a step first cancels every
 * queued stamp landing at or after its own start (`charge_automation`'s stale
 * drop, mirroring `RampedParam::cancel_stale`). The anchor is set the only way
 * the engine sets it: at a batch admission, after the stamp's own batch has
 * drained. All of it is applied against the same snapshot that windows the
 * pump, so what is sent is what the engine can hold.
 */

import { logger } from '#/infra/logger/appLogger';

import { type AudioGraphApplyResult, type AudioGraphParameterWrite } from '../../models/AudioGraphBackend';
import { automationWriteCommand } from '../offlineRender/automationWriteCommand';

import { carryQueuedStamps } from './carryQueuedStamps';
import {
    AUTOMATION_QUEUE_CAPACITY,
    AUTOMATION_QUEUE_MARGIN,
    AUTOMATION_WINDOW_SECONDS,
    DEVICE_PARAM_QUEUE_CAPACITY,
    SEAMS_PROVING_A_WHOLE_PASS,
    nativeLiveAutomationWriter,
    writeStartSeconds,
    type LiveAutomationQueuedStamp,
    type LiveAutomationWriterPass,
    type LiveAutomationWriterTarget,
} from './nativeLiveAutomationWriterState';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { readNativeChain } from './readNativeChain';
import { recordNativeChains } from './recordNativeChains';
import { reportAttachedPlugins } from './reportAttachedPlugins';

export type PumpNativeLiveAutomationWriterInput = Readonly<{
    /** The engine's own clock, as of the snapshot this pump answers. */
    positionSeconds: number;
    /**
     * The engine's cumulative loop-wrap count, or `null` when the caller holds
     * no snapshot — the arm's own first pump, which runs before the feed has
     * read the engine even once.
     */
    loopWraps: number | null;
    /**
     * How many fenced batches the engine had drained when this snapshot was
     * taken, or `null` when the caller holds no snapshot. This is what dates
     * the snapshot against the command that opened the pass; nothing else on
     * it can.
     */
    batchesApplied: number | null;
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
        return {
            startFrame: frameAt(write.startTime, sampleRate),
            landFrame: frameAt(write.landTime, sampleRate),
            admittedBatch: null,
            seamAnchor: null,
        };
    }
    const frame = frameAt(write.time, sampleRate);
    return { startFrame: frame, landFrame: frame, admittedBatch: null, seamAnchor: null };
}

/** A step appends; every other shape this writer carries cancels the stale first. */
function cancelsStale(write: AudioGraphParameterWrite): boolean {
    return write.shape !== 'step';
}

/**
 * Whether this snapshot was taken before the command that opened the pass had
 * reached the audio thread.
 *
 * A locate resolves when its batch is fenced onto the engine's command ring,
 * not when the engine drains it, and the transport publishes its position once
 * per audio callback. So a poll already in flight when the pass was re-armed
 * carries the new pass's epoch and the *old* world's position, and a position
 * is no witness of its own age: a reading at 2.5 s looks exactly the same
 * whether the engine is still there or was moved to 6 s a callback ago. Taken
 * for the pass, it would window the new pass in the region the musician just
 * left — and inside a loop it would read as a wrap and flush the whole region's
 * curve as past-stamped writes.
 *
 * The batch count is the witness, because it only ever moves forward as the
 * audio thread drains fences. A reading that has not reached the fence the
 * opening command was admitted at was taken before that command applied, and
 * is dropped whole — no seam, no wrap bookkeeping, no admission — rather than
 * corrected, because every number on it belongs to the world it was read in.
 */
function readBeforeThePassOpened(pass: LiveAutomationWriterPass, batchesApplied: number | null): boolean {
    if (batchesApplied === null || pass.provenAfterBatch === null) {
        return false;
    }
    return batchesApplied < pass.provenAfterBatch;
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
 *
 * That reading is sound only because {@link readBeforeThePassOpened} has
 * already dropped every snapshot from before the pass opened. A position behind
 * the entry means a wrap once it is known to postdate the locate; without that
 * it would equally mean a poll that crossed the locate, and a forward seek
 * inside a loop region would be read as a seam.
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

/**
 * Drop what the engine's echo proves popped — `proven_popped` in `graph.rs`,
 * both halves.
 *
 * Both the playhead proof and the seam proof first require the write's admitting
 * fenced batch to be at or behind the echoed batch horizon (`batchesApplied >=
 * stamp.admittedBatch`, matching `proven_popped` in
 * `crates/sourdaw-native/src/commands/graph.rs`).
 * Until then the engine has not even drained that batch (or has not yet been
 * handed it), so neither proof may release the stamp.
 *
 * The playhead half: a stamp strictly below the echoed playhead is popped. The
 * seam half: a loop pins the playhead below the region's end — the block that
 * straddles the seam publishes the wrapped position, never the frames it
 * walked to get there — so a stamp in that last stretch is never behind an
 * echo, and it releases once {@link SEAMS_PROVING_A_WHOLE_PASS} seams have
 * closed since its anchor and its start frame is below the frame the last wrap
 * walked to, whose floor the pass holds.
 *
 * The anchor is the half's delicate piece. The engine sets it
 * (`landed_wraps`'s `get_or_insert`) only from `release_landed`, which runs
 * only as a batch is admitted (`apply_graph_commands`) — and only once the stamp's own
 * batch has drained, because `admitted_batch > batches_applied` returns
 * unproven before the anchor is read. The mirror holds the same two facts per
 * stamp — the fence its batch was admitted at rides the apply result, and a
 * snapshot's `batchesApplied` dates a drain — so {@link anchorStampsAtAdmission}
 * sets the anchor on ticks that send a batch, from the same snapshot that
 * windows the send, and only the fence-less fallback anchors here. Anchoring
 * anywhere else — on the release-only ticks of the admission silence before a
 * seam — dates the stamp one seam earlier than the engine can, and the release
 * then fires one pass early: the mirror believes a slot the ledger still
 * charges, and the engine refuses the batch that believed it.
 */
function releaseLanded(
    pass: LiveAutomationWriterPass,
    positionSeconds: number,
    loopWraps: number | null,
    batchesApplied: number | null
): void {
    const playheadFrame = frameAt(positionSeconds, pass.sampleRate);
    for (const slot of pass.targets) {
        slot.queued = slot.queued.filter(
            (stamp) => !provenPopped(pass, stamp, playheadFrame, loopWraps, batchesApplied)
        );
    }
}

/**
 * `proven_popped` in `crates/sourdaw-native/src/commands/graph.rs`: both proofs
 * gate on `admittedBatch <= batchesApplied`, followed by the playhead proof and
 * the seam proof.
 */
function provenPopped(
    pass: LiveAutomationWriterPass,
    stamp: LiveAutomationQueuedStamp,
    playheadFrame: number,
    loopWraps: number | null,
    batchesApplied: number | null
): boolean {
    if (stamp.admittedBatch !== null && (batchesApplied === null || batchesApplied < stamp.admittedBatch)) {
        return false;
    }
    if (stamp.startFrame < playheadFrame) {
        return true;
    }
    if (loopWraps === null || pass.wrapFloorFrame === null) {
        return false;
    }
    if (stamp.admittedBatch === null) {
        // No fence to wait a drain out on: the fallback anchors the way the
        // mirror did before fences were read, on the first tick that finds
        // the stamp queued.
        stamp.seamAnchor ??= loopWraps;
    }
    return (
        stamp.seamAnchor !== null &&
        loopWraps - stamp.seamAnchor >= SEAMS_PROVING_A_WHOLE_PASS &&
        stamp.startFrame < pass.wrapFloorFrame
    );
}

/**
 * Anchor what this admission's snapshot can prove drained — the cadence the
 * engine's ledger keeps, because `release_landed` runs only when a batch is
 * admitted.
 *
 * A tick that sends nothing is the admission silence between those calls: an
 * unanchored stamp keeps its `null` through it, however many ticks pass. The
 * anchor lands on the first tick that actually sends a batch whose snapshot
 * has reached the stamp's own fence — the earliest echo that can postdate an
 * admission after that batch drained — and takes that snapshot's wrap count,
 * exactly the value `landed_wraps`'s `get_or_insert` would read.
 */
function anchorStampsAtAdmission(
    pass: LiveAutomationWriterPass,
    loopWraps: number | null,
    batchesApplied: number | null
): void {
    if (loopWraps === null || batchesApplied === null || pass.wrapFloorFrame === null) {
        return;
    }
    for (const slot of pass.targets) {
        for (const stamp of slot.queued) {
            if (stamp.seamAnchor !== null || stamp.admittedBatch === null) {
                continue;
            }
            if (batchesApplied >= stamp.admittedBatch) {
                stamp.seamAnchor = loopWraps;
            }
        }
    }
}

/**
 * Which of the engine's queues this slot is charged against.
 *
 * A strip parameter owns its own `RampedParam` queue, so it is its own group.
 * Every parameter of one plugin shares that effect's single `DeviceParamQueue`
 * (`QueueBudgets::charge_device_param` keys per effect), so all of one
 * `(trackId, deviceId)`'s slots are one group — charging them separately would
 * let a pass admit the whole ceiling per parameter and have the engine refuse
 * the batch whole.
 */
function ledgerGroup(slot: LiveAutomationWriterTarget): string {
    const { target } = slot;
    if (target.kind === 'device-parameter') {
        return `device:${target.trackId}:${target.deviceId}`;
    }
    if (target.kind === 'track-send-level') {
        return `${target.kind}:${target.trackId}:${target.busId}`;
    }
    return `${target.kind}:${target.trackId}`;
}

/** How deep the engine's queue for this slot's group is allowed to get. */
function groupCeiling(slot: LiveAutomationWriterTarget): number {
    const capacity = slot.target.kind === 'device-parameter' ? DEVICE_PARAM_QUEUE_CAPACITY : AUTOMATION_QUEUE_CAPACITY;
    return capacity - AUTOMATION_QUEUE_MARGIN;
}

/** What the mirror believes each ledger group already holds across all of its slots. */
function queuedByGroup(pass: LiveAutomationWriterPass): Map<string, number> {
    const depths = new Map<string, number>();
    for (const slot of pass.targets) {
        const group = ledgerGroup(slot);
        depths.set(group, (depths.get(group) ?? 0) + slot.queued.length);
    }
    return depths;
}

/**
 * Whether the engine still holds the device this slot writes.
 *
 * `graph.rs` refuses a whole `write-device-parameter` batch with `unknown
 * device` when any target names a device its graph no longer has — so one
 * plugin removed under a pass in flight would stop every other target's cursor
 * too, and no cursor advancing means the identical poisoned batch goes out
 * again on the next tick. A vanished device is therefore dropped from the
 * batch rather than allowed to carry it down. Only the chain the engine
 * *reports* answers this: a device on project truth that no splice has placed
 * is not one the engine can be written.
 */
function engineStillHoldsSlotDevice(slot: LiveAutomationWriterTarget): boolean {
    const { target } = slot;
    if (target.kind !== 'device-parameter') {
        return true;
    }
    return readNativeChain(target.trackId)?.includes(target.deviceId) ?? false;
}

/**
 * The writes each target owes inside the lookahead, in curve order.
 *
 * A ramp is admitted on its start, never on its landing, and never split: the
 * engine re-anchors it at the value the parameter holds at that start frame,
 * so the whole trajectory is one write or it is not that trajectory.
 *
 * The ceiling is counted per ledger group rather than per slot, so a plugin
 * whose parameters share one engine queue cannot be over-admitted by handing
 * each of them the whole capacity.
 */
function admitWindow(input: { pass: LiveAutomationWriterPass; positionSeconds: number }): readonly Admission[] {
    const { pass } = input;
    const horizon = input.positionSeconds + AUTOMATION_WINDOW_SECONDS;
    const depths = queuedByGroup(pass);
    const admissions: Admission[] = [];
    for (const slot of pass.targets) {
        if (!engineStillHoldsSlotDevice(slot)) {
            continue;
        }
        const group = ledgerGroup(slot);
        const ceiling = groupCeiling(slot);
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
            // What the group holds once this slot's own cancellations are
            // taken: the other slots' depths, plus what survives here.
            const groupDepth = (depths.get(group) ?? 0) - queued.length + surviving.length;
            if (groupDepth >= ceiling) {
                break;
            }
            depths.set(group, groupDepth + 1);
            queued = [...surviving, stamp];
            writes.push(write);
        }
        if (writes.length > 0) {
            admissions.push({ slot, writes, queued });
        }
    }
    return admissions;
}

/**
 * Say a refusal once per pass when it is a full queue, and every time when it
 * is anything else.
 *
 * Both of the engine's capacity refusals count: a strip position is charged
 * against `automation-queue-capacity` and a hosted plugin's parameters against
 * their effect's shared `device-param-queue-capacity`. Either arrives on every
 * animation frame for as long as the queue stays full, which is a log nobody
 * can read past — while a refusal of any other kind is news each time it
 * happens.
 */
function reportRefusal(pass: LiveAutomationWriterPass, reason: string): void {
    const queueFull = reason.includes('automation-queue-capacity') || reason.includes('device-param-queue-capacity');
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
    if (readBeforeThePassOpened(pass, input.batchesApplied)) {
        return;
    }

    takeLoopSeam({ pass, positionSeconds: input.positionSeconds, loopWraps: input.loopWraps });
    releaseLanded(pass, input.positionSeconds, input.loopWraps, input.batchesApplied);

    const admissions = admitWindow({ pass, positionSeconds: input.positionSeconds });
    if (admissions.length === 0) {
        return;
    }
    // This tick sends a batch, and a batch admission is the only moment the
    // engine's ledger runs its release proof: anchor what this snapshot — the
    // one that windows the send — can prove drained.
    anchorStampsAtAdmission(pass, input.loopWraps, input.batchesApplied);

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
                    writes.map((write) => automationWriteCommand(slot.target, write))
                ),
            });
        });
        if (result === null || nativeLiveAutomationWriter.epoch !== epoch) {
            return;
        }
        reportAttachedPlugins(result);
        if (result.application !== 'applied') {
            // Nothing moves. The engine took none of it — a refusal is
            // whole-batch, before anything is pushed — so the next tick offers
            // the same writes again rather than stepping over them.
            reportRefusal(pass, result.reason);
            return;
        }
        // A pass writes parameters and edits no chain, but its reports are still
        // the engine's own account of the strips it touched — folding them in
        // keeps the chain record answering to the newest observation there is.
        recordNativeChains(result.reports);
        for (const { slot, writes, queued } of admissions) {
            slot.cursor += writes.length;
            // The batch's own stamps — the tail of what the admission queued,
            // one per write it carried — learn their fence now:
            // `admitted_batch` is the number the engine gave this admission,
            // and the seam anchor waits for a snapshot that has drained it.
            for (const stamp of queued.slice(queued.length - writes.length)) {
                stamp.admittedBatch = result.admittedBatch ?? null;
            }
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
