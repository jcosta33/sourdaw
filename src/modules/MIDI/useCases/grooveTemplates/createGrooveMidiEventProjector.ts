import { defaultGrooveTemplateState, grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { getGrooveProjection } from './getGrooveProjection';

type GrooveMidiEvent = { id: string; startBeat: number; duration: number; velocity: number };
type GrooveClipMidiEventProjectionInput<Event extends GrooveMidiEvent> = {
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
};
type GrooveSequencerMidiEventProjectionInput<Event extends GrooveMidiEvent> = {
    events: readonly Event[];
    phase: 'sequencer-groove';
};
type GrooveMidiEventProjector = <Event extends GrooveMidiEvent>(
    input: GrooveClipMidiEventProjectionInput<Event> | GrooveSequencerMidiEventProjectionInput<Event>
) => readonly Event[];

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
        if (input.phase === 'sequencer-groove') {
            return [
                ...projection.projectCommittedGroove({
                    events: input.events,
                    consumerType: 'sequencer',
                    consumerId: 'project',
                }),
            ];
        }
        return projection.projectClipMidiEvents(input);
    };
}
