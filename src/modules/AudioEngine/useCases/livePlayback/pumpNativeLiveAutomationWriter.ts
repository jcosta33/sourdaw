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
 */

import { logger } from '#/infra/logger/appLogger';

import { type AudioGraphApplyResult, type AudioGraphParameterWrite } from '../../models/AudioGraphBackend';

import {
    AUTOMATION_FILL_BUDGET,
    AUTOMATION_WINDOW_SECONDS,
    nativeLiveAutomationWriter,
    writeStartSeconds,
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
}>;

/** One target's share of one batch. */
type Admission = Readonly<{
    slot: LiveAutomationWriterTarget;
    writes: readonly AudioGraphParameterWrite[];
}>;

/** The cursor position that resumes a target's curve at `seconds`. */
function cursorAtOrAfter(writes: readonly AudioGraphParameterWrite[], seconds: number): number {
    const index = writes.findIndex((write) => writeStartSeconds(write) >= seconds);
    if (index < 0) {
        return writes.length;
    }
    return index;
}

/**
 * Take the seam, when the snapshot says one closed.
 *
 * The engine walked the pass's writes out of its queue on the way to the loop
 * end and wrapping does not put them back, so the next pass has to be sent the
 * region again from its start. This is the per-pass re-arm `graph.rs` leaves
 * to this owner.
 */
function rewindOnLoopSeam(input: { pass: LiveAutomationWriterPass; loopWraps: number | null }): void {
    const { pass, loopWraps } = input;
    if (loopWraps === null) {
        return;
    }
    if (pass.lastLoopWraps === null) {
        pass.lastLoopWraps = loopWraps;
        return;
    }
    if (loopWraps === pass.lastLoopWraps) {
        return;
    }
    pass.lastLoopWraps = loopWraps;
    for (const slot of pass.targets) {
        slot.cursor = cursorAtOrAfter(slot.writes, pass.regionStartSeconds);
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
    const horizon = input.positionSeconds + AUTOMATION_WINDOW_SECONDS;
    const admissions: Admission[] = [];
    for (const slot of input.pass.targets) {
        const writes: AudioGraphParameterWrite[] = [];
        for (const write of slot.writes.slice(slot.cursor)) {
            if (writes.length === AUTOMATION_FILL_BUDGET) {
                break;
            }
            if (writeStartSeconds(write) >= horizon) {
                break;
            }
            writes.push(write);
        }
        if (writes.length > 0) {
            admissions.push({ slot, writes });
        }
    }
    return admissions;
}

export async function pumpNativeLiveAutomationWriter(input: PumpNativeLiveAutomationWriterInput): Promise<void> {
    const pass = nativeLiveAutomationWriter.pass;
    const backend = nativeLiveGraphSession.backend;
    if (!pass || !backend) {
        return;
    }
    const epoch = nativeLiveAutomationWriter.epoch;
    if (nativeLiveAutomationWriter.inFlightEpoch === epoch) {
        return;
    }

    rewindOnLoopSeam({ pass, loopWraps: input.loopWraps });

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
            logger.warn(`[AudioEngine] live automation batch refused: ${result.reason}`);
            return;
        }
        for (const { slot, writes } of admissions) {
            slot.cursor += writes.length;
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
