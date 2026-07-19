import { projectCommittedGroove } from '#/modules/MIDI/useCases';

type SequencerGrooveEvent = {
    id: string;
    startBeat: number;
    velocity: number;
};

export function projectSequencerGroove<Event extends SequencerGrooveEvent>(event: Event): Event {
    const [projected = event] = projectCommittedGroove({
        events: [event],
        consumerType: 'sequencer',
        consumerId: 'project',
    });
    return projected;
}
