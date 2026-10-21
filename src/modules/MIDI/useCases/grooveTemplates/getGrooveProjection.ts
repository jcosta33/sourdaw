import { isBeatInClipLoopWindow } from '#/utils/clipLoopOrigin';

import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';
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
    /**
     * The clip's loop anchor (#4988). Playback callers carry it so the loop
     * window stays anchored to the source across start trims; absent, the
     * window admits everything below the loop length, exactly as before the
     * anchor existed (display and legacy callers).
     */
    loopOriginBeat?: number;
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

            function createSegment(startBeat: number, endBeat: number): Event[] {
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
                return [
                    {
                        ...event,
                        startBeat: clippedStartBeat,
                        duration: clippedEndBeat - clippedStartBeat,
                        velocity: sequencerProjected.velocity,
                    },
                ];
            }

            if (!loopEnabled || loopLengthBeats <= 0) {
                return createSegment(intervalStartBeat, intervalEndBeat);
            }

            const offsetFromIteration = intervalStartBeat - iterationStartBeat;
            const moduloOffset = ((offsetFromIteration % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
            // A start that float noise leaves just below a loop length is the next pass head,
            // not a sliver at the loop end followed by the whole note again at that head.
            const wrappedOffset = loopLengthBeats - moduloOffset <= SAME_BEAT_TOLERANCE ? 0 : moduloOffset;
            const wrappedStartBeat = iterationStartBeat + wrappedOffset;
            const preservedDuration = Math.min(intervalDurationBeats, loopLengthBeats);
            const firstEndBeat = Math.min(iterationStartBeat + loopLengthBeats, wrappedStartBeat + preservedDuration);
            const firstSegments = createSegment(wrappedStartBeat, firstEndBeat);
            const remainingDuration = preservedDuration - (firstEndBeat - wrappedStartBeat);
            // On a non-dyadic grid the first segment's end misses the note's end by float noise,
            // so a note that stops at or before the loop end still leaves a remainder of that size.
            if (remainingDuration <= SAME_BEAT_TOLERANCE) {
                return firstSegments;
            }
            const wrappedSegments = createSegment(iterationStartBeat, iterationStartBeat + remainingDuration);
            return [...wrappedSegments, ...firstSegments];
        });
    }
    const created = { projectCommittedGroove, projectClipMidiEvents };
    projectionsByState.set(state, created);
    return created;
}
