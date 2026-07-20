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
    phase?: 'clip-groove' | 'complete';
}) => Event[];

export function createGrooveMidiEventProjector(): GrooveMidiEventProjector {
    const grooveState = structuredClone(grooveTemplateStore.value ?? defaultGrooveTemplateState);
    const projection = getGrooveProjection(grooveState);
    return (input) => {
        if (input.phase === 'clip-groove') {
            return [
                ...projection.projectCommittedGroove({
                    events: input.events,
                    consumerType: 'clip',
                    consumerId: input.clipId,
                }),
            ];
        }
        return projection.projectClipMidiEvents(input);
    };
}
