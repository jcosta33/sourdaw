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
    /**
     * The timeline beat the take ended at in this clip. Absent for a clip the
     * recorder opened: the take ended where the clip does.
     */
    takeEndBeat?: number;
};

export type RecordedControllerPlan = {
    cc: MidiCC[];
    pitchBend: MidiPitchBend[];
};

function isRecordedAtBeatZero(rows: readonly MidiCC[], seed: MidiCC): boolean {
    return rows.some((row) => row.beat === 0 && row.controller === seed.controller && row.channel === seed.channel);
}

/**
 * The rows a commit of `clip` will write: the take's buffered rows, led by
 * the pedals that were already held when the take began, except those the take
 * records at beat 0 itself, and closed by a lift for each pedal the take leaves
 * engaged (`planPedalLifts`), at the beat the take ended, never past the clip's
 * closing line. Empty for a clip with nothing buffered or whose commit already
 * took its buffer.
 *
 * Reads only. The recording commit asks for this while it describes its redo
 * snapshot, ahead of the write that lands the same rows with the same ids.
 */
export function planRecordedControllers({ clip, takeEndBeat }: PlanRecordedControllersInput): RecordedControllerPlan {
    const { buffers, openedClipIds, heldPedalSeeds } = recordedControllerTakeState;
    const buffer = buffers.get(clip.id);
    const recordedCc = buffer?.cc ?? [];
    const recordedPitchBend = buffer?.pitchBend ?? [];
    const seed = openedClipIds.has(clip.id) ? heldPedalSeeds.get(clip.id) : undefined;
    const seedRows = (seed ?? []).filter((row) => !isRecordedAtBeatZero(recordedCc, row));
    const takenRows = [...seedRows, ...recordedCc];

    const mediaOrigin = clipMediaOriginBeat(clip);
    const lifts = planPedalLifts({
        rows: takenRows,
        takeEndBeat: (takeEndBeat ?? clip.endBeat) - mediaOrigin,
        closingLineBeat: clip.endBeat - mediaOrigin,
    });

    return {
        cc: [...takenRows, ...lifts],
        pitchBend: [...recordedPitchBend],
    };
}
