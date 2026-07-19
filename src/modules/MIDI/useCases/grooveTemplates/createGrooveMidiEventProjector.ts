import { defaultGrooveTemplateState, grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { getGrooveProjection } from './getGrooveProjection';

type GrooveMidiEvent = { id: string; startBeat: number; duration: number; velocity: number };
type GrooveMidiEventProjector = <Event extends GrooveMidiEvent>(input: {
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
}) => Event[];

export function createGrooveMidiEventProjector(): GrooveMidiEventProjector {
    const grooveState = structuredClone(grooveTemplateStore.value ?? defaultGrooveTemplateState);
    return getGrooveProjection(grooveState).projectClipMidiEvents;
}
