import { type MidiPitchBend } from '../../models/MidiNote';

import { listClipControllerPasses, type ControllerProjectionClip } from './listClipControllerPasses';
import { projectMidiClipWindow } from './projectMidiClipWindow';

type ProjectClipPitchBendEventsInput = {
    pitchBends: readonly MidiPitchBend[];
    clip: ControllerProjectionClip;
    /** The window `[fromBeat, toBeat)` on the timeline; a bend belongs to exactly one such window. */
    fromBeat: number;
    toBeat: number;
};

/** A channel pitch-bend move a clip plays, at its absolute beat. */
export type ProjectedClipPitchBend = MidiPitchBend & {
    /** Where the row sits in the clip's content, before the pass and the content offset placed it. */
    contentBeat: number;
    /**
     * Where the row was recorded in the clip's content: `contentBeat`, except for a carry, which sits on the pass
     * head though its row was recorded before it. A caller reads the state the row was recorded under here.
     */
    recordedContentBeat: number;
    /**
     * Where the pass that plays the move puts the row's own content beat on the timeline: `beat` for a row the
     * pass reaches, and earlier for a carry, which sits on the pass head though the row was recorded before it
     * (before the clip start, for a row of a trimmed-off head).
     */
    recordedBeat: number;
};

type RecordedPitchBend = MidiPitchBend & Pick<ProjectedClipPitchBend, 'recordedContentBeat'>;

/**
 * The channel pitch-bend moves a clip plays inside the timeline window `[fromBeat, toBeat)`,
 * at their absolute beats, in beat order.
 *
 * Bend is placed as a stored controller is, by the same passes (`listClipControllerPasses`) and
 * the same carry rule (`projectMidiClipWindow`): every loop pass and the clip start begin from
 * the bend in force at the span's head, and a move sits where a note at that content beat does.
 * A carry sits on its pass head, so a window opening mid-clip emits none; a caller that needs the
 * bend in force at a beat reads the window `(-inf, beat)` and takes the last move. A carry still
 * says where its row was recorded (`recordedBeat`), so a caller can tell a move made before a
 * note's own bend from one made after it.
 *
 * Bend is a continuous position like CC1, so it has no closing line: a row exactly on the clip
 * end is dropped, nothing of the clip is left to bend, and the last bend before it stays in
 * force, as a bend a clip leaves out stays out until a row says otherwise.
 */
export function projectClipPitchBendEvents({
    pitchBends,
    clip,
    fromBeat,
    toBeat,
}: ProjectClipPitchBendEventsInput): ProjectedClipPitchBend[] {
    if (pitchBends.length === 0) {
        return [];
    }
    const events: ProjectedClipPitchBend[] = [];
    // The carry moves a row to the pass head, so each row takes its own content beat along to say where it was recorded.
    const recordedPitchBends: RecordedPitchBend[] = pitchBends.map((bend) => ({
        ...bend,
        recordedContentBeat: bend.beat,
    }));

    for (const window of listClipControllerPasses(clip, { fromBeat, toBeat })) {
        const projected = projectMidiClipWindow({
            notes: [],
            controlChanges: [],
            pitchBends: recordedPitchBends,
            window,
        });
        for (const bend of projected.pitchBends) {
            if (bend.beat >= fromBeat && bend.beat < toBeat) {
                events.push({
                    ...bend,
                    contentBeat: bend.beat - window.beatOffset,
                    recordedBeat: bend.recordedContentBeat + window.beatOffset,
                });
            }
        }
    }

    return events.sort((left, right) => left.beat - right.beat);
}
