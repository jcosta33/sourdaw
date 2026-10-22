import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';
import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

type PlanRecordedControllersInput = {
    clipId: string;
};

export type RecordedControllerPlan = {
    cc: MidiCC[];
    pitchBend: MidiPitchBend[];
};

function isRecordedAtBeatZero(rows: readonly MidiCC[], seed: MidiCC): boolean {
    return rows.some((row) => row.beat === 0 && row.controller === seed.controller && row.channel === seed.channel);
}

/**
 * The rows a commit of `clipId` will write: the take's buffered rows, led by
 * the pedals that were already held when the take began, except those the take
 * records at beat 0 itself. Empty for a clip with nothing buffered or whose
 * commit already took its buffer.
 *
 * Reads only. The recording commit asks for this while it describes its redo
 * snapshot, ahead of the write that lands the same rows with the same ids.
 */
export function planRecordedControllers({ clipId }: PlanRecordedControllersInput): RecordedControllerPlan {
    const { buffers, openedClipIds, heldPedalSeeds } = recordedControllerTakeState;
    const buffer = buffers.get(clipId);
    const recordedCc = buffer?.cc ?? [];
    const recordedPitchBend = buffer?.pitchBend ?? [];
    const seed = openedClipIds.has(clipId) ? heldPedalSeeds.get(clipId) : undefined;
    const seedRows = (seed ?? []).filter((row) => !isRecordedAtBeatZero(recordedCc, row));

    return {
        cc: [...seedRows, ...recordedCc],
        pitchBend: [...recordedPitchBend],
    };
}
