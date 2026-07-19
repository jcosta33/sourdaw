import { grooveTemplateStore, type GrooveConsumerType } from '../../stores/grooveTemplateStore';

import { getGrooveProjection } from './getGrooveProjection';

type CommittedGrooveEvent = { id: string; startBeat: number; velocity: number };
type ProjectCommittedGrooveInput<Event extends CommittedGrooveEvent> = {
    events: readonly Event[];
    consumerType: GrooveConsumerType;
    consumerId: string;
};

export function projectCommittedGroove<Event extends CommittedGrooveEvent>({
    events,
    consumerType,
    consumerId,
}: ProjectCommittedGrooveInput<Event>): readonly Event[] {
    const state = grooveTemplateStore.value;
    if (!state) {
        return events;
    }
    return getGrooveProjection(state).projectCommittedGroove({ events, consumerType, consumerId });
}
