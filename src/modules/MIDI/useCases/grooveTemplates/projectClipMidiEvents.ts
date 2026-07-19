import { defaultGrooveTemplateState, grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { getGrooveProjection } from './getGrooveProjection';

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
    return getGrooveProjection(grooveTemplateStore.value ?? defaultGrooveTemplateState).projectClipMidiEvents({
        events,
        clipId,
        clipStartBeat,
        clipEndBeat,
        iterationStartBeat,
        loopLengthBeats,
        midiOffsetBeats,
        clipGrooveAlreadyApplied,
        eventsAreAbsolute,
    });
}
