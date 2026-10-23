import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';
import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

type PendingOverdubRows = {
    cc: MidiCC[];
    pitchBend: MidiPitchBend[];
};

/**
 * The rows earlier overdub passes planned into this clip whose dispatch has not
 * settled, in the order the passes ended, less any the store already holds: a
 * dispatch that has written leaves the pending set a moment later, and those
 * rows must count once.
 *
 * A later pass declares its registered-parameter state against these as well
 * as the stored rows, so its result is the one it would have had if the earlier
 * pass had landed at its own falling edge.
 */
export function readPendingOverdubRows(
    clipId: string,
    storedCc: readonly MidiCC[],
    storedPitchBend: readonly MidiPitchBend[]
): PendingOverdubRows {
    const storedCcIds = new Set(storedCc.map((row) => row.id));
    const storedPitchBendIds = new Set(storedPitchBend.map((row) => row.id));
    const pending: PendingOverdubRows = { cc: [], pitchBend: [] };
    for (const pass of recordedControllerTakeState.pendingOverdubPasses) {
        for (const clip of pass) {
            if (clip.clipId !== clipId) {
                continue;
            }
            pending.cc.push(...clip.cc.filter((row) => !storedCcIds.has(row.id)));
            pending.pitchBend.push(...clip.pitchBend.filter((row) => !storedPitchBendIds.has(row.id)));
        }
    }
    return pending;
}
