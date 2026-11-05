import { resolveClipLoopOriginAdvance, resolveClipLoopPassGrid } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import {
    getScheduledIterationRange,
    getSourceOccurrenceOffset,
    MAX_GROOVE_STAGE_DISPLACEMENT_BEATS,
    type GetScheduledIterationRangeInput,
    type ScheduledIterationRange,
} from '../../services/midiSchedulerWindowGeometry';

import { getScheduledMidiNoteIndex, type ScheduledMidiNote } from './getScheduledMidiNoteIndex';

import type { resolveMidiWindowClips } from './resolveMidiWindowClips';

type RawYeastPassClip = Pick<
    ReturnType<typeof resolveMidiWindowClips>[number],
    'startBeat' | 'endBeat' | 'loopEnabled' | 'loopLength' | 'loopOriginBeat' | 'midiOffsetBeats' | 'sourceStartBeat'
>;

type RawClipYeastPasses = {
    loopLength: number;
    /** Where pass 0 opens on the anchor's grid; pass `n` opens `n` loops later. */
    firstPassStartBeat: number;
    /** The occurrence pass 0 rolls on. */
    sourceOccurrenceOffset: number;
    /** The passes that overlap the scheduler window. */
    activeIterationRange: ScheduledIterationRange;
    /** The passes whose notes the window may own: the active ones widened by what reaches into it. */
    candidateIterationRange: ScheduledIterationRange;
};

function getYeastCandidateIterationRange({
    clipStartBeat,
    fromBeat,
    iterationCount,
    loopEnabled,
    loopLengthBeats,
    midiOffsetBeats,
    loopAdvanceBeats,
    toBeat,
    notes,
}: GetScheduledIterationRangeInput & {
    midiOffsetBeats: number;
    /** The trim advance a row's pass placement adds; `clipStartBeat` is the first grid pass's start. */
    loopAdvanceBeats: number;
    notes: readonly ScheduledMidiNote[];
}): ScheduledIterationRange {
    const activeRange = getScheduledIterationRange({
        clipStartBeat,
        fromBeat,
        iterationCount,
        loopEnabled,
        loopLengthBeats,
        toBeat,
    });
    if (!loopEnabled || notes.length === 0) {
        return activeRange;
    }
    const { maxDurationBeats, maxEndpointBeat } = getScheduledMidiNoteIndex(notes);
    // #4655 — endpoints are content beats; their audible position inside an
    // iteration is the offset-relative start, wrapped into the iteration when
    // it slips before the head. A looped iteration therefore owns note-ons up
    // to `max(loopLength, widest positive reach)` past its start, and a
    // wrapped note rings its release that far plus its duration, so the range
    // widens backwards by both and forwards only while the iteration start
    // still precedes the window.
    const latestOwnedOffsetBeats = Math.max(loopLengthBeats, maxEndpointBeat - midiOffsetBeats + loopAdvanceBeats);
    const firstEndpointIndex = Math.max(
        0,
        Math.ceil(
            (fromBeat -
                MAX_GROOVE_STAGE_DISPLACEMENT_BEATS -
                clipStartBeat -
                latestOwnedOffsetBeats -
                maxDurationBeats) /
                loopLengthBeats
        )
    );
    const endpointEndIndex = Math.min(
        iterationCount,
        Math.floor((toBeat + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS - clipStartBeat) / loopLengthBeats) + 1
    );
    return {
        startIndex: Math.min(activeRange.startIndex, firstEndpointIndex),
        endIndex: Math.max(activeRange.endIndex, endpointEndIndex),
    };
}

/**
 * The passes of a raw (not frozen) clip the Yeast route prepares for one
 * scheduler window, on the anchor's pass grid (`resolveClipLoopPassGrid`).
 */
export function resolveRawClipYeastPasses({
    clip,
    sourceNotes,
    fromBeat,
    toBeat,
}: {
    clip: RawYeastPassClip;
    sourceNotes: readonly ScheduledMidiNote[];
    fromBeat: number;
    toBeat: number;
}): RawClipYeastPasses {
    const loopEnabled = clip.loopEnabled ?? false;
    const loopProjection = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled,
    });
    const loopLength = loopProjection.loopLengthBeats;
    const loopPassGrid = resolveClipLoopPassGrid({
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled,
        loopLengthBeats: loopLength,
        iterationCount: loopProjection.iterationCount,
    });
    const sourceOccurrenceOffset =
        getSourceOccurrenceOffset({
            sourceStartBeat: clip.sourceStartBeat,
            segmentStartBeat: clip.startBeat,
            loopLength,
            loopEnabled,
        }) + loopPassGrid.passesAheadOfAnchor;
    const rangeInput = {
        clipStartBeat: loopPassGrid.firstPassStartBeat,
        fromBeat,
        iterationCount: loopPassGrid.passCount,
        loopEnabled,
        loopLengthBeats: loopLength,
        toBeat,
    };
    return {
        loopLength,
        firstPassStartBeat: loopPassGrid.firstPassStartBeat,
        sourceOccurrenceOffset,
        activeIterationRange: getScheduledIterationRange(rangeInput),
        candidateIterationRange: getYeastCandidateIterationRange({
            ...rangeInput,
            midiOffsetBeats: clip.midiOffsetBeats ?? 0,
            loopAdvanceBeats: resolveClipLoopOriginAdvance({
                startBeat: clip.startBeat,
                loopOriginBeat: clip.loopOriginBeat,
                loopEnabled,
            }),
            notes: sourceNotes,
        }),
    };
}
