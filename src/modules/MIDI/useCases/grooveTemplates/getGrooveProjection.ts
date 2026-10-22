import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';
import { type GrooveTemplateState } from '../../stores/grooveTemplateStore';

import { applyGrooveTemplate } from './applyGrooveTemplate';

type GrooveEvent = { id: string; startBeat: number; velocity: number };
/** `beatsIntoNote` on an input event is the cut an earlier stage already made of its note (Yeast plays what the clip head left). */
type ClipMidiEvent = GrooveEvent & { duration: number; beatsIntoNote?: number };
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
        clipGrooveAlreadyApplied = false,
        eventsAreAbsolute = false,
    }: ProjectClipMidiEventsInput<Event>): Event[] {
        const clipProjected = clipGrooveAlreadyApplied
            ? events
            : projectCommittedGroove({ events, consumerType: 'clip', consumerId: clipId });

        return clipProjected.flatMap((event) => {
            const relativeStartBeat = event.startBeat - midiOffsetBeats;
            if (!eventsAreAbsolute && relativeStartBeat >= loopLengthBeats) {
                return [];
            }
            const absoluteStartBeat = eventsAreAbsolute ? event.startBeat : iterationStartBeat + relativeStartBeat;
            const [sequencerProjected = event] = projectCommittedGroove({
                events: [{ ...event, startBeat: absoluteStartBeat }],
                consumerType: 'sequencer',
                consumerId: 'project',
            });
            const intervalStartBeat = sequencerProjected.startBeat;
            const intervalDurationBeats = sequencerProjected.duration;
            const intervalEndBeat = intervalStartBeat + intervalDurationBeats;
            const iterationEndBeat = Math.min(clipEndBeat, iterationStartBeat + loopLengthBeats);

            // `beatsIntoNoteAtStart` is how far into the note `startBeat` is, before the clip cuts it.
            function createSegment(
                startBeat: number,
                endBeat: number,
                beatsIntoNoteAtStart: number
            ): ProjectedSegment<Event>[] {
                const allowedStartBeat = Math.max(iterationStartBeat, clipStartBeat);
                if (endBeat === startBeat) {
                    if (startBeat < allowedStartBeat || startBeat >= iterationEndBeat) {
                        return [];
                    }
                    return [
                        {
                            ...event,
                            startBeat,
                            duration: 0,
                            velocity: sequencerProjected.velocity,
                        },
                    ];
                }
                const clippedStartBeat = Math.max(iterationStartBeat, clipStartBeat, startBeat);
                const clippedEndBeat = Math.min(iterationEndBeat, endBeat);
                if (clippedEndBeat <= clippedStartBeat) {
                    return [];
                }
                const segment: ProjectedSegment<Event> = {
                    ...event,
                    startBeat: clippedStartBeat,
                    duration: clippedEndBeat - clippedStartBeat,
                    velocity: sequencerProjected.velocity,
                };
                const beatsIntoNote =
                    (event.beatsIntoNote ?? 0) + beatsIntoNoteAtStart + (clippedStartBeat - startBeat);
                if (beatsIntoNote > 0) {
                    segment.beatsIntoNote = beatsIntoNote;
                }
                return [segment];
            }

            if (!loopEnabled || loopLengthBeats <= 0) {
                return createSegment(intervalStartBeat, intervalEndBeat, 0);
            }

            const offsetFromIteration = intervalStartBeat - iterationStartBeat;
            const moduloOffset = ((offsetFromIteration % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
            // A start that float noise leaves just below a loop length is the next pass head,
            // not a sliver at the loop end followed by the whole note again at that head.
            const wrappedOffset = loopLengthBeats - moduloOffset <= SAME_BEAT_TOLERANCE ? 0 : moduloOffset;
            const wrappedStartBeat = iterationStartBeat + wrappedOffset;
            const preservedDuration = Math.min(intervalDurationBeats, loopLengthBeats);
            const firstEndBeat = Math.min(iterationStartBeat + loopLengthBeats, wrappedStartBeat + preservedDuration);
            const firstSegments = createSegment(wrappedStartBeat, firstEndBeat, 0);
            const remainingDuration = preservedDuration - (firstEndBeat - wrappedStartBeat);
            // On a non-dyadic grid the first segment's end misses the note's end by float noise,
            // so a note that stops at or before the loop end still leaves a remainder of that size.
            if (remainingDuration <= SAME_BEAT_TOLERANCE) {
                return firstSegments;
            }
            const wrappedSegments = createSegment(
                iterationStartBeat,
                iterationStartBeat + remainingDuration,
                firstEndBeat - wrappedStartBeat
            );
            return [...wrappedSegments, ...firstSegments];
        });
    }
    const created = { projectCommittedGroove, projectClipMidiEvents };
    projectionsByState.set(state, created);
    return created;
}
