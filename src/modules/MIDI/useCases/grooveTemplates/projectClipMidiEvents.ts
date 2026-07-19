import { projectCommittedGroove } from './projectCommittedGroove';

type ClipMidiEvent = {
    id: string;
    startBeat: number;
    duration: number;
    velocity: number;
};

type ProjectClipMidiEventsInput<Event extends ClipMidiEvent> = {
    events: readonly Event[];
    clipId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    clipGrooveAlreadyApplied?: boolean;
    eventsAreAbsolute?: boolean;
};

export function projectClipMidiEvents<Event extends ClipMidiEvent>({
    events,
    clipId,
    clipStartBeat,
    clipEndBeat,
    iterationStartBeat,
    loopLengthBeats,
    midiOffsetBeats,
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
        const boundedStartBeat = Math.max(iterationStartBeat, clipStartBeat, sequencerProjected.startBeat);
        const boundedEndBeat = Math.min(clipEndBeat, boundedStartBeat + event.duration);
        if (boundedEndBeat <= boundedStartBeat) {
            return [];
        }

        return [
            {
                ...event,
                startBeat: boundedStartBeat,
                duration: boundedEndBeat - boundedStartBeat,
                velocity: sequencerProjected.velocity,
            },
        ];
    });
}
