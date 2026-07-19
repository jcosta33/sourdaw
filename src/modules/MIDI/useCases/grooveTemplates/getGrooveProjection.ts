import { type GrooveTemplateState } from '../../stores/grooveTemplateStore';

import { applyGrooveTemplate } from './applyGrooveTemplate';

type GrooveEvent = { id: string; startBeat: number; velocity: number };
type ClipMidiEvent = GrooveEvent & { duration: number };
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
type GrooveProjection = {
    projectCommittedGroove: <Event extends GrooveEvent>(input: ProjectCommittedGrooveInput<Event>) => readonly Event[];
    projectClipMidiEvents: <Event extends ClipMidiEvent>(input: ProjectClipMidiEventsInput<Event>) => Event[];
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
    const projectCommittedGroove = <Event extends GrooveEvent>({
        events,
        consumerType,
        consumerId,
    }: ProjectCommittedGrooveInput<Event>): readonly Event[] => {
        const assignment = assignmentsByConsumer.get(`${consumerType}:${consumerId}`);
        const template = assignment ? templatesById.get(assignment.templateId) : undefined;
        return assignment && template ? applyGrooveTemplate({ events, template, amount: assignment.amount }) : events;
    };
    const projectClipMidiEvents = <Event extends ClipMidiEvent>({
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
    }: ProjectClipMidiEventsInput<Event>): Event[] => {
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

            const createSegment = (startBeat: number, endBeat: number): Event[] => {
                const clippedStartBeat = Math.max(iterationStartBeat, clipStartBeat, startBeat);
                const clippedEndBeat = Math.min(iterationEndBeat, endBeat);
                if (clippedEndBeat <= clippedStartBeat) {
                    return [];
                }
                return [
                    {
                        ...event,
                        startBeat: clippedStartBeat,
                        duration: clippedEndBeat - clippedStartBeat,
                        velocity: sequencerProjected.velocity,
                    },
                ];
            };

            if (!loopEnabled || loopLengthBeats <= 0) {
                return createSegment(intervalStartBeat, intervalEndBeat);
            }

            const offsetFromIteration = intervalStartBeat - iterationStartBeat;
            const wrappedOffset = ((offsetFromIteration % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
            const wrappedStartBeat = iterationStartBeat + wrappedOffset;
            const preservedDuration = Math.min(intervalDurationBeats, loopLengthBeats);
            const firstEndBeat = Math.min(iterationStartBeat + loopLengthBeats, wrappedStartBeat + preservedDuration);
            const firstSegments = createSegment(wrappedStartBeat, firstEndBeat);
            const remainingDuration = preservedDuration - (firstEndBeat - wrappedStartBeat);
            if (remainingDuration <= 0) {
                return firstSegments;
            }
            const wrappedSegments = createSegment(iterationStartBeat, iterationStartBeat + remainingDuration);
            return [...wrappedSegments, ...firstSegments];
        });
    };
    const created = { projectCommittedGroove, projectClipMidiEvents };
    projectionsByState.set(state, created);
    return created;
}
