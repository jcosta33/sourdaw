import { grooveTemplateStore } from '#/modules/MIDI/stores';
import { applyGrooveTemplate, getGrooveTemplate } from '#/modules/MIDI/useCases';

import { getToasterPatternGrooveStatus, type ToasterPatternGrooveStatus } from './getToasterPatternGrooveStatus';

type ToasterGrooveEvent = {
    id: string;
    startBeat: number;
    velocity: number;
};

type ProjectToasterPatternGrooveInput<Event extends ToasterGrooveEvent> = {
    deviceId: string;
    patternId: string;
    stepsPerBar: number;
    events: readonly Event[];
};

type ProjectToasterPatternGrooveResult<Event extends ToasterGrooveEvent> =
    | {
          ok: true;
          events: readonly Event[];
          status: Extract<ToasterPatternGrooveStatus, { status: 'unassigned' | 'ready' }>;
      }
    | { ok: false; status: Exclude<ToasterPatternGrooveStatus, { status: 'unassigned' | 'ready' }> };

export function projectToasterPatternGroove<Event extends ToasterGrooveEvent>({
    deviceId,
    patternId,
    stepsPerBar,
    events,
}: ProjectToasterPatternGrooveInput<Event>): ProjectToasterPatternGrooveResult<Event> {
    const status = getToasterPatternGrooveStatus({
        deviceId,
        patternId,
        stepsPerBar,
        grooveState: grooveTemplateStore.value ?? undefined,
    });
    if (status.status === 'unassigned') {
        return { ok: true, events, status };
    }
    if (status.status !== 'ready') {
        return { ok: false, status };
    }
    const template = getGrooveTemplate(status.templateId);
    if (!template) {
        return { ok: false, status: { status: 'missing-template', templateId: status.templateId } };
    }
    return {
        ok: true,
        events: applyGrooveTemplate({ events, template, amount: status.amount }),
        status,
    };
}
