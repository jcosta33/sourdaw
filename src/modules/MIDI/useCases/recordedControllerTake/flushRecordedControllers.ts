import {
    recordedControllerTakeState,
    type RecordedCcRow,
} from '../../repositories/webMidi/recordedControllerTakeState';

import { writeRecordedControllerRows } from './writeRecordedControllerRows';

type FlushRecordedControllersInput = {
    clipId: string;
    /** The track the committed clip belongs to. */
    trackId: string;
};

function isRecordedAtBeatZero(rows: readonly RecordedCcRow[], seed: RecordedCcRow): boolean {
    return rows.some((row) => row.beat === 0 && row.controller === seed.controller && row.channel === seed.channel);
}

/**
 * The pedals already held when the take began, for the clip the live input
 * recorded into, except those the take itself records at beat 0. Spent once:
 * a take's seed belongs to the first clip it commits on that track.
 */
function takeHeldPedalRows(clipId: string, trackId: string, recorded: readonly RecordedCcRow[]): RecordedCcRow[] {
    const { heldPedalSeed, openedClipIds } = recordedControllerTakeState;
    if (!heldPedalSeed || heldPedalSeed.trackId !== trackId || !openedClipIds.has(clipId)) {
        return [];
    }
    recordedControllerTakeState.heldPedalSeed = null;
    return heldPedalSeed.rows.filter((seed) => !isRecordedAtBeatZero(recorded, seed));
}

/**
 * Write a committing take's controller and pitch-bend rows into its clip, in
 * one store write, and close the clip to further rows.
 *
 * Call it before the commit reads the clip's MIDI data for its redo snapshot:
 * the rows exist only here until then, so a snapshot read first would restore
 * the take without them. The held-pedal rows lead the clip's list, ahead of
 * every message the take recorded.
 */
export function flushRecordedControllers({ clipId, trackId }: FlushRecordedControllersInput): void {
    const { buffers, committedClipIds } = recordedControllerTakeState;
    const buffer = buffers.get(clipId);
    buffers.delete(clipId);
    committedClipIds.add(clipId);

    const recordedCc = buffer?.cc ?? [];
    writeRecordedControllerRows({
        clipId,
        cc: [...takeHeldPedalRows(clipId, trackId, recordedCc), ...recordedCc],
        pitchBend: buffer?.pitchBend ?? [],
    });
}
