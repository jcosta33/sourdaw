import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
import {
    LOOP_PASS_GROOVE_INSTANCE_SUFFIX,
    LOOP_PASS_OVERFLOW_INSTANCE_SUFFIX,
    loopPassGrooveDisplacedNoteStartBeat,
    loopPassNoteEndBeat,
    loopPassNoteOverflowBeats,
    loopPassProducedNoteStartBeat,
} from '#/utils/loopPassNoteSegments';

type OfflineYeastPassIteration = {
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    loopEnabled: boolean;
    clipStartBeat: number;
    loopOriginBeat?: number;
};

/** A source row after the clip-groove phase: its stored figure, grooved. */
type OfflineYeastGroovedNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

/** The project groove's placement of one absolute note start: where it moves the start, and the velocity it gives. */
type OfflineYeastSequencerGroove = (event: {
    id: string;
    startBeat: number;
    velocity: number;
}) => { startBeat: number; velocity: number } | undefined;

/**
 * One note the rack is handed for a pass: absolute beats, and how far into its source row it begins.
 * `sequencerGrooveApplied` marks a segment the project groove moved out of its pass, placed before the rack.
 */
export type OfflineYeastPassNote = {
    id: string;
    sourceNoteId: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    beatsIntoNote: number;
    sequencerGrooveApplied: boolean;
};

function passNote(
    note: OfflineYeastGroovedNote,
    id: string,
    startBeat: number,
    endBeat: number,
    beatsIntoNote: number
): OfflineYeastPassNote[] {
    if (endBeat <= startBeat) {
        return [];
    }
    return [
        {
            id,
            sourceNoteId: note.id,
            pitch: note.pitch,
            startBeat,
            duration: endBeat - startBeat,
            velocity: note.velocity,
            beatsIntoNote,
            sequencerGrooveApplied: false,
        },
    ];
}

/** A head off the grid opens the first pass before the clip does; the clip head cuts what that pass places ahead of it. */
function cutAtClipHead(
    iteration: OfflineYeastPassIteration,
    note: OfflineYeastGroovedNote,
    id: string,
    startBeat: number,
    endBeat: number,
    beatsIntoNote: number
): OfflineYeastPassNote[] {
    const cutBeats = Math.max(0, iteration.clipStartBeat - startBeat);
    return passNote(note, id, startBeat + cutBeats, endBeat, beatsIntoNote + cutBeats);
}

/**
 * A pass segment as the rack is handed it: where the project groove, which
 * follows the rack, would move its start out of its pass, the segment is
 * placed where the loop puts it, already grooved
 * (`loopPassGrooveDisplacedNoteStartBeat`), with what then rings past the pass
 * end handed on as its own note struck on the pass head, as the live window
 * must hand both to reach the beats they land on; otherwise unchanged.
 */
function placeProjectGrooveDisplacement(
    iteration: OfflineYeastPassIteration,
    note: OfflineYeastGroovedNote,
    segment: OfflineYeastPassNote,
    projectSequencerGroove: OfflineYeastSequencerGroove
): OfflineYeastPassNote[] {
    const { iterationStartBeat: passStartBeat, loopLengthBeats } = iteration;
    const grooved = projectSequencerGroove({ id: note.id, startBeat: segment.startBeat, velocity: segment.velocity });
    const displacedStartBeat =
        grooved && loopPassGrooveDisplacedNoteStartBeat(grooved.startBeat, passStartBeat, loopLengthBeats);
    if (!grooved || displacedStartBeat === undefined) {
        return [segment];
    }
    const { duration } = segment;
    const displacedEndBeat = loopPassNoteEndBeat(displacedStartBeat, duration, passStartBeat, loopLengthBeats);
    const overflowBeats = loopPassNoteOverflowBeats(displacedStartBeat, duration, passStartBeat, loopLengthBeats);
    const groovedNote = { ...note, velocity: grooved.velocity };
    const displacedId = `${segment.id}${LOOP_PASS_GROOVE_INSTANCE_SUFFIX}`;
    const placed = cutAtClipHead(
        iteration,
        groovedNote,
        displacedId,
        displacedStartBeat,
        displacedEndBeat,
        segment.beatsIntoNote
    );
    if (overflowBeats > 0) {
        placed.push(
            ...cutAtClipHead(
                iteration,
                groovedNote,
                `${displacedId}${LOOP_PASS_OVERFLOW_INSTANCE_SUFFIX}`,
                passStartBeat,
                passStartBeat + overflowBeats,
                segment.beatsIntoNote + displacedEndBeat - displacedStartBeat
            )
        );
    }
    return placed.map((placedSegment) => ({ ...placedSegment, sequencerGrooveApplied: true }));
}

/**
 * The notes one offline Yeast iteration hands the rack, segmented exactly as
 * the live window hands them (`processLiveYeastTrackBlock`), so a rack plays
 * the same input whether it is bounced or played. A row sounds at its audible
 * beat on the anchor's pass grid. A non-looped pass clamps a start before its
 * head to the head and keeps the row's end. A looped pass plays the row as
 * `loopPassNoteSegments` cuts it: ending at the pass end, with what would
 * ring past it handed on as its own note struck on the pass head, because a
 * live window cannot see a note-on later in its pass and the bounce must not
 * hear what playback cannot. For the same reason a segment the project groove
 * moves out of its pass is handed on where the loop places it.
 */
export function segmentOfflineYeastPassNotes(
    iteration: OfflineYeastPassIteration,
    groovedNotes: readonly OfflineYeastGroovedNote[],
    projectSequencerGroove: OfflineYeastSequencerGroove
): OfflineYeastPassNote[] {
    const { iterationStartBeat: passStartBeat, loopLengthBeats } = iteration;
    const loops = iteration.loopEnabled && loopLengthBeats > 0;
    const contentZeroBeat =
        passStartBeat +
        resolveClipLoopOriginAdvance({
            startBeat: iteration.clipStartBeat,
            loopOriginBeat: iteration.loopOriginBeat,
            loopEnabled: iteration.loopEnabled,
        });
    return groovedNotes.flatMap((note) => {
        const audibleStartBeat = contentZeroBeat + note.startBeat - iteration.midiOffsetBeats;
        if (!loops) {
            const startBeat = Math.max(audibleStartBeat, passStartBeat);
            return passNote(note, note.id, startBeat, audibleStartBeat + note.duration, startBeat - audibleStartBeat);
        }
        const passNoteStartBeat = loopPassProducedNoteStartBeat(audibleStartBeat, passStartBeat, loopLengthBeats);
        const passNoteEndBeat = loopPassNoteEndBeat(passNoteStartBeat, note.duration, passStartBeat, loopLengthBeats);
        const overflowBeats = loopPassNoteOverflowBeats(
            passNoteStartBeat,
            note.duration,
            passStartBeat,
            loopLengthBeats
        );
        const segments = cutAtClipHead(iteration, note, note.id, passNoteStartBeat, passNoteEndBeat, 0);
        if (overflowBeats > 0) {
            segments.push(
                ...cutAtClipHead(
                    iteration,
                    note,
                    `${note.id}${LOOP_PASS_OVERFLOW_INSTANCE_SUFFIX}`,
                    passStartBeat,
                    passStartBeat + overflowBeats,
                    passNoteEndBeat - passNoteStartBeat
                )
            );
        }
        return segments.flatMap((segment) =>
            placeProjectGrooveDisplacement(iteration, note, segment, projectSequencerGroove)
        );
    });
}
