import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';
import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';
import { clipMediaOriginBeat } from '../../services/clipMediaOriginBeat';
import { pitchBendLaneKey } from '../../services/pitchBendLaneKey';

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
 * Whether the take's first pass records a row of the seed's lane (a pedal's
 * controller and channel, a wheel's channel and scope) at beat 0 itself. A loop take overlays every pass into one clip, and a pass
 * only moves forward, so a row at beat 0 that arrives after a row later in the
 * clip belongs to a later pass: it does not stand in for the press the start
 * of the take owes.
 */
function isRecordedAtBeatZero<TRow extends { beat: number }>(
    rows: readonly TRow[],
    isSameLane: (row: TRow) => boolean
): boolean {
    for (const row of rows) {
        if (row.beat > 0) {
            return false;
        }
        if (isSameLane(row)) {
            return true;
        }
    }
    return false;
}

/**
 * The rows a commit of `clip` will write: the take's buffered rows, led by
 * the pitch-bend range the input had declared and the pedals that were already
 * held when the take began (except those the take records at beat 0 itself), and
 * its bend lane led by the wheels held off centre when it began (except a lane,
 * `pitchBendLaneKey`, the take records a bend in at beat 0 itself); the controller list
 * closed by a lift for each pedal the take leaves
 * engaged (`planPedalLifts`), on the clip's closing line. Empty for a clip with nothing buffered or whose commit already
 * took its buffer.
 *
 * Reads only. The recording commit asks for this while it describes its redo
 * snapshot, ahead of the write that lands the same rows with the same ids.
 */
export function planRecordedControllers({ clip }: PlanRecordedControllersInput): RecordedControllerPlan {
    const { buffers, openedClipIds, heldPedalSeeds, bendRangeSeeds, heldWheelSeeds } = recordedControllerTakeState;
    const buffer = buffers.get(clip.id);
    const recordedCc = buffer?.cc ?? [];
    const recordedPitchBend = buffer?.pitchBend ?? [];
    const opened = openedClipIds.has(clip.id);
    const seedRows = ((opened ? heldPedalSeeds.get(clip.id) : undefined) ?? []).filter(
        (seed) =>
            !isRecordedAtBeatZero(
                recordedCc,
                (row) => row.controller === seed.controller && row.channel === seed.channel
            )
    );
    const wheelRows = ((opened ? heldWheelSeeds.get(clip.id) : undefined) ?? []).filter(
        (seed) => !isRecordedAtBeatZero(recordedPitchBend, (row) => pitchBendLaneKey(row) === pitchBendLaneKey(seed))
    );
    const bendRangeRows = (opened ? bendRangeSeeds.get(clip.id) : undefined) ?? [];
    const takenRows = [...bendRangeRows, ...seedRows, ...recordedCc];

    const lifts = planPedalLifts({
        rows: takenRows,
        closingLineBeat: clip.endBeat - clipMediaOriginBeat(clip),
    });

    return {
        cc: [...takenRows, ...lifts],
        pitchBend: [...wheelRows, ...recordedPitchBend],
    };
}
