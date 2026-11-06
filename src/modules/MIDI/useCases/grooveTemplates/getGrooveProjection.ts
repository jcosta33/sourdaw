import { isBeatInClipLoopWindow, resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
import {
    loopPassGrooveDisplacedNoteStartBeat,
    loopPassNoteEndBeat,
    loopPassNoteOverflowBeats,
    loopPassNoteStartBeat,
} from '#/utils/loopPassNoteSegments';

import { type GrooveTemplateState } from '../../stores/grooveTemplateStore';

import { applyGrooveTemplate } from './applyGrooveTemplate';

type GrooveEvent = { id: string; startBeat: number; velocity: number };
/**
 * `beatsIntoNote` on an input event is the cut an earlier stage already made of its note (Yeast plays what the clip head
 * left). `sequencerGrooveApplied` marks an event the project groove already placed: a Yeast segment it moves out of its
 * pass is handed to the rack at its landing (`loopPassGrooveDisplacedNoteStartBeat`) and must not be grooved again.
 */
type ClipMidiEvent = GrooveEvent & { duration: number; beatsIntoNote?: number; sequencerGrooveApplied?: boolean };
type ProjectCommittedGrooveInput<Event extends GrooveEvent> = {
    events: readonly Event[];
    consumerType: GrooveTemplateState['assignments'][number]['consumerType'];
    consumerId: string;
};
type ProjectClipMidiEventsInput<Event extends ClipMidiEvent> = {
    events: readonly Event[];
    clipId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    loopEnabled?: boolean;
    /**
     * The clip's loop anchor (#4988). Playback callers carry it so the loop
     * window stays anchored to the source across start trims; absent, the
     * window admits everything below the loop length, exactly as before the
     * anchor existed (display and legacy callers). Carried, it also places
     * the loop on the anchor's pass grid (`resolveClipLoopPassGrid`):
     * `iterationStartBeat` is then a grid seam, and each row plays its phase
     * in the anchored loop, `relative + advance`, into the pass.
     */
    loopOriginBeat?: number;
    clipGrooveAlreadyApplied?: boolean;
    eventsAreAbsolute?: boolean;
};
/**
 * A note as one clip pass plays it. `beatsIntoNote` is how far into its own (grooved, uncut) extent the
 * segment begins, absent when it begins with the note: a clip trim or a pass boundary cuts the head off,
 * and the tail of a note that wraps a clip loop begins where the first segment ends. Whatever is measured
 * from the note's start (a recorded expression curve) is measured from `startBeat - beatsIntoNote`.
 */
export type ProjectedSegment<Event> = Event & { beatsIntoNote?: number };
type GrooveProjection = {
    projectCommittedGroove: <Event extends GrooveEvent>(input: ProjectCommittedGrooveInput<Event>) => readonly Event[];
    projectClipMidiEvents: <Event extends ClipMidiEvent>(
        input: ProjectClipMidiEventsInput<Event>
    ) => ProjectedSegment<Event>[];
};

const projectionsByState = new WeakMap<GrooveTemplateState, GrooveProjection>();

/**
 * Whether the project groove carries an absolute start inside its pass to or past the pass end. Such a start was
 * carried there after its producer played it (a rack re-timed it): the loop law puts it on the pass head, which a
 * live window has already played by then, so it sounds on no route. The moves a producer can foresee it hands on
 * itself, already placed where the loop puts them (`sequencerGrooveApplied`).
 */
function isPushedPastPassEndAfterItsProducer(
    producedStartBeat: number,
    groovedStartBeat: number,
    passStartBeat: number,
    loopLengthBeats: number
): boolean {
    const offsetBeats = groovedStartBeat - passStartBeat;
    return (
        producedStartBeat >= passStartBeat &&
        offsetBeats >= 0 &&
        loopPassGrooveDisplacedNoteStartBeat(groovedStartBeat, passStartBeat, loopLengthBeats) !== undefined
    );
}

/** One event of one clip pass, grooved: what each of its segments carries, and the bounds that cut them. */
type ProjectedSegmentSource<Event extends ClipMidiEvent> = {
    event: Event;
    velocity: number;
    iterationStartBeat: number;
    clipStartBeat: number;
    /** The pass end, or the clip end when it comes first. */
    iterationEndBeat: number;
};

/**
 * The segment of the event over `[startBeat, endBeat)` cut to its pass and its clip, or none when nothing is left.
 * `beatsIntoNoteAtStart` is how far into the note `startBeat` is, before the clip cuts it.
 */
function createProjectedSegment<Event extends ClipMidiEvent>(
    { event, velocity, iterationStartBeat, clipStartBeat, iterationEndBeat }: ProjectedSegmentSource<Event>,
    startBeat: number,
    endBeat: number,
    beatsIntoNoteAtStart: number
): ProjectedSegment<Event>[] {
    const allowedStartBeat = Math.max(iterationStartBeat, clipStartBeat);
    if (endBeat === startBeat) {
        if (startBeat < allowedStartBeat || startBeat >= iterationEndBeat) {
            return [];
        }
        return [{ ...event, startBeat, duration: 0, velocity }];
    }
    const clippedStartBeat = Math.max(allowedStartBeat, startBeat);
    const clippedEndBeat = Math.min(iterationEndBeat, endBeat);
    if (clippedEndBeat <= clippedStartBeat) {
        return [];
    }
    const segment: ProjectedSegment<Event> = {
        ...event,
        startBeat: clippedStartBeat,
        duration: clippedEndBeat - clippedStartBeat,
        velocity,
    };
    const beatsIntoNote = (event.beatsIntoNote ?? 0) + beatsIntoNoteAtStart + (clippedStartBeat - startBeat);
    if (beatsIntoNote > 0) {
        segment.beatsIntoNote = beatsIntoNote;
    }
    return [segment];
}

type LoopPassInterval = {
    /** The grooved start and length. */
    startBeat: number;
    durationBeats: number;
    loopLengthBeats: number;
    eventsAreAbsolute: boolean;
};

/**
 * The pass segmentation every route shares (`loopPassNoteSegments`): the in-pass segment, and the tail that rings
 * past the pass end struck on the pass head.
 *
 * Absolute events were segmented by their producer before it played them: a Yeast rack is handed each pass's tail
 * as its own note at the head, and every segment the project groove moves out of its pass already placed. A tail
 * this projection would still strike on the head was added after that, by the rack (length that runs past the pass
 * end, or a start the project groove pulls back across the head): a live window could only strike it after the head
 * had passed, so an absolute event ends at the pass end on every route.
 */
function segmentLoopPass<Event extends ClipMidiEvent>(
    source: ProjectedSegmentSource<Event>,
    { startBeat, durationBeats, loopLengthBeats, eventsAreAbsolute }: LoopPassInterval
): ProjectedSegment<Event>[] {
    const { iterationStartBeat } = source;
    const wrappedStartBeat = loopPassNoteStartBeat(startBeat, iterationStartBeat, loopLengthBeats);
    const firstEndBeat = loopPassNoteEndBeat(wrappedStartBeat, durationBeats, iterationStartBeat, loopLengthBeats);
    const firstSegments = createProjectedSegment(source, wrappedStartBeat, firstEndBeat, 0);
    const overflowBeats = loopPassNoteOverflowBeats(
        wrappedStartBeat,
        durationBeats,
        iterationStartBeat,
        loopLengthBeats
    );
    if (overflowBeats === 0 || eventsAreAbsolute) {
        return firstSegments;
    }
    const wrappedSegments = createProjectedSegment(
        source,
        iterationStartBeat,
        iterationStartBeat + overflowBeats,
        firstEndBeat - wrappedStartBeat
    );
    return [...wrappedSegments, ...firstSegments];
}

export function getGrooveProjection(state: GrooveTemplateState): GrooveProjection {
    const existing = projectionsByState.get(state);
    if (existing) {
        return existing;
    }
    const assignmentsByConsumer = new Map(
        state.assignments.map((assignment) => [`${assignment.consumerType}:${assignment.consumerId}`, assignment])
    );
    const templatesById = new Map(state.templates.map((template) => [template.id, template]));
    function projectCommittedGroove<Event extends GrooveEvent>({
        events,
        consumerType,
        consumerId,
    }: ProjectCommittedGrooveInput<Event>): readonly Event[] {
        const assignment = assignmentsByConsumer.get(`${consumerType}:${consumerId}`);
        const template = assignment ? templatesById.get(assignment.templateId) : undefined;
        if (!assignment || !template) {
            return events;
        }
        return applyGrooveTemplate({ events, template, amount: assignment.amount });
    }
    function projectClipMidiEvents<Event extends ClipMidiEvent>({
        events,
        clipId,
        clipStartBeat,
        clipEndBeat,
        iterationStartBeat,
        loopLengthBeats,
        midiOffsetBeats,
        loopEnabled = false,
        loopOriginBeat,
        clipGrooveAlreadyApplied = false,
        eventsAreAbsolute = false,
    }: ProjectClipMidiEventsInput<Event>): Event[] {
        const clipProjected = clipGrooveAlreadyApplied
            ? events
            : projectCommittedGroove({ events, consumerType: 'clip', consumerId: clipId });
        // A row's place in a grid pass is its offset-relative start plus the
        // trim advance: its phase in the loop the anchor laid down.
        const loopAdvanceBeats = eventsAreAbsolute
            ? 0
            : resolveClipLoopOriginAdvance({ startBeat: clipStartBeat, loopOriginBeat, loopEnabled });

        // Order law (#5198 review): the committed clip groove displaces a
        // stored start FIRST and the loop window below reads the GROOVED
        // content figure — `groovedStart - midiOffsetBeats`. Every admission
        // gate paired with this projection evaluates that same figure: the
        // live generator's admission (`selectMidiNotesForLoopWindow`, passed
        // the clip id) and scheduleMidiNotes' per-note test both groove the
        // candidate before the window test. A groove carrying a note across a
        // window bound therefore flips its admission on the live and offline
        // twins together — a note either chain sounds, the other sounds. The
        // rack chains invert the order (they admit the stored row before
        // their own groove phase) and are internally consistent on the
        // stored figure.
        return clipProjected.flatMap((event) => {
            const relativeStartBeat = event.startBeat - midiOffsetBeats;
            if (
                !eventsAreAbsolute &&
                !isBeatInClipLoopWindow({
                    relativeBeat: relativeStartBeat,
                    startBeat: clipStartBeat,
                    loopOriginBeat,
                    loopLengthBeats,
                    loopEnabled,
                })
            ) {
                return [];
            }
            const absoluteStartBeat = eventsAreAbsolute
                ? event.startBeat
                : iterationStartBeat + relativeStartBeat + loopAdvanceBeats;
            const placedEvent = { ...event, startBeat: absoluteStartBeat };
            const [sequencerProjected = event] = event.sequencerGrooveApplied
                ? [placedEvent]
                : projectCommittedGroove({
                      events: [placedEvent],
                      consumerType: 'sequencer',
                      consumerId: 'project',
                  });
            const segmentSource = {
                event,
                velocity: sequencerProjected.velocity,
                iterationStartBeat,
                clipStartBeat,
                iterationEndBeat: Math.min(clipEndBeat, iterationStartBeat + loopLengthBeats),
            };
            const intervalStartBeat = sequencerProjected.startBeat;
            const intervalDurationBeats = sequencerProjected.duration;
            if (!loopEnabled || loopLengthBeats <= 0) {
                return createProjectedSegment(
                    segmentSource,
                    intervalStartBeat,
                    intervalStartBeat + intervalDurationBeats,
                    0
                );
            }
            if (
                eventsAreAbsolute &&
                isPushedPastPassEndAfterItsProducer(
                    event.startBeat,
                    intervalStartBeat,
                    iterationStartBeat,
                    loopLengthBeats
                )
            ) {
                return [];
            }
            return segmentLoopPass(segmentSource, {
                startBeat: intervalStartBeat,
                durationBeats: intervalDurationBeats,
                loopLengthBeats,
                eventsAreAbsolute,
            });
        });
    }
    const created = { projectCommittedGroove, projectClipMidiEvents };
    projectionsByState.set(state, created);
    return created;
}
