/**
 * Send one live MIDI batch, and move the pass only if the engine took it
 * (#3892).
 *
 * Shared by the arm and the pump, which differ only in the span they cover and
 * in whether they clear ahead of it. What happens to a batch afterwards is one
 * law, and a second copy of it would be a second belief about a store there is
 * only one of.
 *
 * A cursor is a claim that the engine accepted those events. A refusal is
 * whole-batch — `try_extend` pushes nothing before it decides — so nothing
 * moves and the same events are offered again on the next tick, rather than a
 * shorter run that stepped over what never landed. The refusal is said once per
 * pass, because it arrives on every animation frame for as long as its cause
 * stands.
 *
 * Applied directly rather than through `queueOnNativeLiveGraphSession`: both
 * senders are reached from inside that chain — the arm from the session start,
 * the pump from the playhead feed's own tick — and an entry the playhead has
 * already passed is counted late and never delivered, so a batch parked behind
 * the session's other work is a batch the take begins without.
 */

import { logger } from '#/infra/logger/appLogger';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { nativeLiveMidiWriter, type LiveMidiWriterPass, type MidiWriterBatch } from './nativeLiveMidiWriterState';
import { reportAttachedPlugins } from './reportAttachedPlugins';

export type ApplyMidiBatchInput = Readonly<{
    pass: LiveMidiWriterPass;
    batch: MidiWriterBatch;
    /** The pass this batch belongs to, as it stood when the batch was built. */
    epoch: number;
}>;

export async function applyMidiBatch(input: ApplyMidiBatchInput): Promise<void> {
    const { pass, batch, epoch } = input;
    const backend = nativeLiveGraphSession.backend;
    if (!backend || batch.commands.length === 0) {
        return;
    }
    nativeLiveMidiWriter.inFlightEpoch = epoch;
    try {
        const result = await backend.apply({ schemaVersion: 1, commands: [...batch.commands] });
        if (nativeLiveMidiWriter.epoch !== epoch) {
            // The pass ended while this round trip was out; its cursors belong
            // to a world that no longer exists.
            return;
        }
        reportAttachedPlugins(result);
        if (result.application !== 'applied') {
            if (!pass.refusalReported) {
                pass.refusalReported = true;
                logger.warn(`[AudioEngine] live MIDI batch refused: ${result.reason}`);
            }
            return;
        }
        for (const admission of batch.admissions) {
            admission.slot.cursor += admission.admitted;
            admission.slot.held = admission.heldAfter;
        }
        if (batch.lastClearedBeforeSeconds !== undefined) {
            pass.lastClearedBeforeSeconds = batch.lastClearedBeforeSeconds;
        }
    } catch (error) {
        // A thrown apply is a bridge fault, not a decision about the notes: the
        // cursors stay where they are and the next tick offers them again.
        logger.warn('[AudioEngine] live MIDI batch failed:', error);
    } finally {
        // Release only what this send claimed; a newer pass may already hold
        // the claim, and clearing that would let its next tick stack a second
        // batch behind its own.
        if (nativeLiveMidiWriter.inFlightEpoch === epoch) {
            nativeLiveMidiWriter.inFlightEpoch = null;
        }
    }
}
