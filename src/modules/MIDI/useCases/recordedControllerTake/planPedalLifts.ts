import { isPedalControllerLift } from '#/utils/pianoPedalController';

import { isHeldPedalCc } from '../../models/MidiControllerState';
import { type MidiCC } from '../../models/MidiNote';

type PlanPedalLiftsInput = {
    /** The take's rows for one clip in arrival order, the pedals held at its start included. */
    rows: readonly MidiCC[];
    /** Where the take ended in the clip, in clip beats. */
    takeEndBeat: number;
    /** The clip's closing line in clip beats: the latest beat a lift can sit on. */
    closingLineBeat: number;
};

/**
 * The lifts a take owes the pedals it leaves engaged.
 *
 * Stored playback plays a lift only from a row inside the clip or on its
 * closing line, so a pedal whose last row is a press would stay down past the
 * clip's end until the transport stops. Cubase writes reset events at the end
 * of a recorded part for the same reason.
 *
 * A pedal is engaged by the same test playback uses to tell a lift: the last
 * row of a pedal and channel is a press when it is not a lift. Last means last
 * in beat order, because a loop take overlays every pass into one clip at its
 * wrapped beat and playback reads the rows sorted by beat; rows sharing a beat
 * keep their arrival order. The lift never sits before the press it ends, and
 * takes its id from that press so planning the same rows twice names the same
 * lifts.
 */
export function planPedalLifts({ rows, takeEndBeat, closingLineBeat }: PlanPedalLiftsInput): MidiCC[] {
    const lastRowByPedal = new Map<string, MidiCC>();
    for (const row of rows) {
        if (!isHeldPedalCc(row.controller)) {
            continue;
        }
        const pedalKey = `${row.channel}:${row.controller}`;
        const last = lastRowByPedal.get(pedalKey);
        if (!last || row.beat >= last.beat) {
            lastRowByPedal.set(pedalKey, row);
        }
    }
    return Array.from(lastRowByPedal.values())
        .filter((row) => !isPedalControllerLift(row.controller, row.value))
        .map((press) => ({
            id: `${press.id}-lift`,
            controller: press.controller,
            value: 0,
            beat: Math.min(closingLineBeat, Math.max(press.beat, takeEndBeat)),
            channel: press.channel,
        }));
}
