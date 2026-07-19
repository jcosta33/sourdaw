import { type GrooveTemplate } from '../../models/GrooveTemplate';

import { applyGrooveTemplate } from './applyGrooveTemplate';
import { getGrooveTemplate } from './getGrooveTemplate';

type PreviewEvent = { id: string; startBeat: number; velocity: number };
type PreviewGrooveTemplateInput<Event extends PreviewEvent> = {
    events: readonly Event[];
    templateId: string;
    amount: number;
};

export function previewGrooveTemplate<Event extends PreviewEvent>({
    events,
    templateId,
    amount,
}: PreviewGrooveTemplateInput<Event>): readonly Event[] {
    const template: GrooveTemplate | undefined = getGrooveTemplate(templateId);
    return template ? applyGrooveTemplate({ events, template, amount }) : events;
}
