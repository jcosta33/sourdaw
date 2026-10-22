import { type MidiCC } from '../../models/MidiNote';

import { listClipControllerPasses, type ControllerProjectionClip } from './listClipControllerPasses';
import { projectMidiClipWindow } from './projectMidiClipWindow';

type ProjectClipControllerEventsInput = {
    controlChanges: readonly MidiCC[];
    clip: ControllerProjectionClip;
    /** The scheduling window `[fromBeat, toBeat)` on the timeline; a controller belongs to exactly one such window. */
    fromBeat: number;
    toBeat: number;
};

/** A controller move a clip plays, at its absolute beat. */
export type ProjectedClipControllerMove = MidiCC & {
    /**
     * Whether the move is a pedal lift on the clip's closing line, at exactly
     * `clip.endBeat` — sustain only at value 0 (a continuous position, so a partial
     * value there is no lift), and the other switch controllers below the latch
     * threshold. Such a move is owned by the window `[fromBeat, toBeat)` with
     * `fromBeat < endBeat <= toBeat` (the last window the clip plays in). At its sample frame the
     * clip's moves apply, in the clip's own order, before the moves of a clip that starts there,
     * so the clip that follows has the last word.
     */
    closesClip: boolean;
};

function ownsMove(move: ProjectedClipControllerMove, fromBeat: number, toBeat: number): boolean {
    if (move.closesClip) {
        return move.beat > fromBeat && move.beat <= toBeat;
    }
    return move.beat >= fromBeat && move.beat < toBeat;
}

/**
 * The controller moves a clip plays inside the timeline window `[fromBeat, toBeat)`,
 * at their absolute beats, in beat order.
 *
 * Each loop pass is projected through `projectMidiClipWindow` over its own visible
 * span, so every pass and the clip start begin from the value in force at the
 * span's head — the carry rule glue, export and split already use — and a move is
 * placed exactly where a note at that content beat is: iteration start plus the
 * beat past `midiOffsetBeats`. No groove applies to a controller.
 *
 * The window is half-open like the note scheduler's, so a move is owned by one
 * window and a scheduler stepping `[a, b)`, `[b, c)` — or wrapping at a loop seam —
 * emits it once. A carried value sits on its pass head, so only the window holding
 * that head emits it: a window that opens mid-clip emits no carry. That is the
 * start-and-seek chase this projection leaves to the transport, but not the
 * relocation of playback already rolling (a loop wrap, a follow-action jump),
 * which the window cannot restore on its own: `projectClipControllerRestore`
 * names what a relocation must send, and the window that opens at the
 * destination still emits the rows sitting on it.
 *
 * A pedal lift on the clip's closing line plays at the
 * clip end, as the last thing the clip does, so a lift drawn on the final bar line ends
 * the sustain there before the next clip starts (Cubase's own reset events after a
 * recording sit on a part's end). A lift is sustain only at value 0 — sustain is a
 * continuous position, so a partial value there lifts nothing — and the other switch
 * controllers below the latch threshold. Any other row there stays dropped: a press would
 * hold past the clip end with nothing of the clip left to hold (a comp cut or a trim
 * landing on a press would leave the pedal down until stop), and a continuous
 * controller would set a value for whatever follows. Only the last pass has that line: an inner loop seam stays half-open, so a row on the
 * loop end is not replayed at every wrap, and notes keep the half-open end everywhere.
 * The move is placed at exactly `clip.endBeat` and owned by the window that closes at
 * or past it: the clip plays in that window and in no later one, so a window that
 * opens on the clip end, where the clip is not scheduled, owes it nothing.
 */
export function projectClipControllerEvents({
    controlChanges,
    clip,
    fromBeat,
    toBeat,
}: ProjectClipControllerEventsInput): ProjectedClipControllerMove[] {
    if (controlChanges.length === 0) {
        return [];
    }
    const events: ProjectedClipControllerMove[] = [];

    for (const window of listClipControllerPasses(clip, { fromBeat, toBeat })) {
        const projected = projectMidiClipWindow({ notes: [], controlChanges, pitchBends: [], window });
        const moves = [
            ...projected.controlChanges.map((event) => ({ ...event, closesClip: false })),
            ...projected.closingControlChanges.map((event) => ({ ...event, closesClip: true })),
        ];
        for (const move of moves) {
            if (ownsMove(move, fromBeat, toBeat)) {
                events.push(move);
            }
        }
    }

    return events.sort((left, right) => left.beat - right.beat);
}
