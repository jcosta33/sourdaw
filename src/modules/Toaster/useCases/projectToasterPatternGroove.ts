import {
    adaptGrooveTemplateForConsumer,
    applyGrooveTemplate,
    getGrooveAssignment,
    getGrooveTemplate,
} from '#/modules/MIDI/useCases';

type ToasterGrooveEvent = {
    id: string;
    startBeat: number;
    velocity: number;
};

type AdapterFailure = Extract<ReturnType<typeof adaptGrooveTemplateForConsumer>, { ok: false }>;

type ProjectToasterPatternGrooveInput<Event extends ToasterGrooveEvent> = {
    patternId: string;
    stepsPerBar: number;
    events: readonly Event[];
};

type ProjectToasterPatternGrooveResult<Event extends ToasterGrooveEvent> =
    | { ok: true; events: readonly Event[] }
    | AdapterFailure;

function getSupportedSubdivisions(
    stepsPerBar: number
): Parameters<typeof adaptGrooveTemplateForConsumer>[0]['supportedSubdivisions'] {
    if (stepsPerBar === 16) {
        return ['1/16'];
    }
    if (stepsPerBar === 32) {
        return ['1/32'];
    }
    return [];
}

export function projectToasterPatternGroove<Event extends ToasterGrooveEvent>({
    patternId,
    stepsPerBar,
    events,
}: ProjectToasterPatternGrooveInput<Event>): ProjectToasterPatternGrooveResult<Event> {
    const assignment = getGrooveAssignment({ consumerType: 'toaster-pattern', consumerId: patternId });
    const template = assignment ? getGrooveTemplate(assignment.templateId) : undefined;
    if (!assignment || !template) {
        return { ok: true, events };
    }

    const supportedSubdivisions = getSupportedSubdivisions(stepsPerBar);
    const adaptation = adaptGrooveTemplateForConsumer({
        consumer: 'toaster',
        template,
        supportsDynamics: true,
        supportedSubdivisions,
    });
    if (!adaptation.ok) {
        return adaptation;
    }

    return { ok: true, events: applyGrooveTemplate({ events, template, amount: assignment.amount }) };
}
