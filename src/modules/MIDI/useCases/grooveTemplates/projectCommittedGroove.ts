import { type GrooveConsumerType } from '../../stores/grooveTemplateStore';

import { applyGrooveTemplate } from './applyGrooveTemplate';
import { getGrooveAssignment } from './getGrooveAssignment';
import { getGrooveTemplate } from './getGrooveTemplate';

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
    const assignment = getGrooveAssignment({ consumerType, consumerId });
    const template = assignment ? getGrooveTemplate(assignment.templateId) : undefined;
    return assignment && template ? applyGrooveTemplate({ events, template, amount: assignment.amount }) : events;
}
