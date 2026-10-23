import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';
import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';
import { clipMediaOriginBeat } from '../../services/clipMediaOriginBeat';

import { planPedalLifts } from './planPedalLifts';

/** The clip a take's rows are planned for, as the timeline holds it. */
export type RecordedClipSpan = {
    id: string;
    startBeat: number;
    endBeat: number;
    midiOffsetBeats?: number;
};

type PlanRecordedControllersInput = {
    clip: RecordedClipSpan;
};

export type RecordedControllerPlan = {
    cc: MidiCC[];
    pitchBend: MidiPitchBend[];
};

/**
 * Whether the take's first pass records the seed's controller and channel at
 * beat 0 itself. A loop take overlays every pass into one clip, and a pass
 * only moves forward, so a row at beat 0 that arrives after a row later in the
 * clip belongs to a later pass: it does not stand in for the press the start
 * of the take owes.
 */
function isRecordedAtBeatZero(rows: readonly MidiCC[], seed: MidiCC): boolean {
    for (const row of rows) {
        if (row.beat > 0) {
            return false;
        }
        if (row.controller === seed.controller && row.channel === seed.channel) {
            return true;
        }
    }
    return false;
}

/**
 * The rows a commit of `clip` will write: the take's buffered rows, led by
 * the pitch-bend range the input had declared and the pedals that were already
 * held when the take began (except those the take records at beat 0 itself), and
 * closed by a lift for each pedal the take leaves
 * engaged (`planPedalLifts`), on the clip's closing line. Empty for a clip with nothing buffered or whose commit already
 * took its buffer.
 *
 * Reads only. The recording commit asks for this while it describes its redo
 * snapshot, ahead of the write that lands the same rows with the same ids.
 */
export function planRecordedControllers({ clip }: PlanRecordedControllersInput): RecordedControllerPlan {
    const { buffers, openedClipIds, heldPedalSeeds, bendRangeSeeds } = recordedControllerTakeState;
    const buffer = buffers.get(clip.id);
    const recordedCc = buffer?.cc ?? [];
    const recordedPitchBend = buffer?.pitchBend ?? [];
    const seed = openedClipIds.has(clip.id) ? heldPedalSeeds.get(clip.id) : undefined;
    const seedRows = (seed ?? []).filter((row) => !isRecordedAtBeatZero(recordedCc, row));
    const bendRangeRows = (openedClipIds.has(clip.id) ? bendRangeSeeds.get(clip.id) : undefined) ?? [];
    const takenRows = [...bendRangeRows, ...seedRows, ...recordedCc];

    const lifts = planPedalLifts({
        rows: takenRows,
        closingLineBeat: clip.endBeat - clipMediaOriginBeat(clip),
    });

    return {
        cc: [...takenRows, ...lifts],
        pitchBend: [...recordedPitchBend],
    };
}
