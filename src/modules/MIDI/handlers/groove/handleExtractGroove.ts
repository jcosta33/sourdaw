import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { STRAIGHT_GROOVE_TEMPLATE_ID } from '../../models/GrooveTemplate';
import { createGrooveTemplate } from '../../useCases/grooveTemplates/createGrooveTemplate';
import { extractGrooveTemplate } from '../../useCases/grooveTemplates/extractGrooveTemplate';
import { getGrooveTemplate } from '../../useCases/grooveTemplates/getGrooveTemplate';
import { getNotesForClip } from '../../useCases/midiNoteCrud/getNotesForClip';

type ExtractGrooveAction = Extract<AppAction, { type: 'extractGroove' }>;

type GrooveExtractionActionErrorCode =
    'empty-source' | 'unsupported-subdivision' | 'invalid-source' | 'template-identity-conflict';
type ExtractedGrooveTemplate = Extract<ReturnType<typeof extractGrooveTemplate>, { ok: true }>['template'];

class GrooveExtractionActionError extends Error {
    readonly code: GrooveExtractionActionErrorCode;

    constructor(code: GrooveExtractionActionErrorCode, message: string) {
        super(message);
        this.name = 'GrooveExtractionActionError';
        this.code = code;
    }
}

type ExtractGroovePlan =
    | { outcome: 'create'; template: ExtractedGrooveTemplate }
    | { outcome: 'straight' }
    | { outcome: 'identical' }
    | { outcome: 'failure'; error: GrooveExtractionActionError }
    | { outcome: 'conflict'; error: GrooveExtractionActionError };

function templatesEqual(
    left: NonNullable<ReturnType<typeof getGrooveTemplate>>,
    right: ExtractedGrooveTemplate
): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function planExtractGroove(action: ExtractGrooveAction): ExtractGroovePlan {
    const result = extractGrooveTemplate({
        sourceId: action.payload.clipId,
        sourceName: action.payload.sourceName ?? action.payload.clipId,
        analyzerVersion: 1,
        subdivision: action.payload.subdivision ?? '1/16',
        templateId: action.payload.templateId ?? `groove-${action.payload.clipId}-v1`,
        notes: getNotesForClip(action.payload.clipId),
    });
    if (!result.ok) {
        return {
            outcome: 'failure',
            error: new GrooveExtractionActionError(
                result.error.code,
                `Groove extraction rejected: ${result.error.code}`
            ),
        };
    }
    const template = result.template;
    if (template.id === STRAIGHT_GROOVE_TEMPLATE_ID) {
        return { outcome: 'straight' };
    }
    const existing = getGrooveTemplate(template.id);
    if (!existing) {
        return { outcome: 'create', template };
    }
    if (templatesEqual(existing, template)) {
        return { outcome: 'identical' };
    }
    return {
        outcome: 'conflict',
        error: new GrooveExtractionActionError(
            'template-identity-conflict',
            `Groove template identity "${template.id}" already has different content`
        ),
    };
}

export const handleExtractGroove = createHandler<'extractGroove'>({
    isNoop: (action) => {
        const plan = planExtractGroove(action);
        return plan.outcome === 'straight' || plan.outcome === 'identical';
    },
    execute: (action) => {
        const plan = planExtractGroove(action);
        if (plan.outcome === 'failure' || plan.outcome === 'conflict') {
            throw plan.error;
        }
        if (plan.outcome === 'create') {
            createGrooveTemplate(plan.template);
            return { status: 'written' };
        }
        return { status: 'no-write' };
    },
    describe: (action) => {
        const plan = planExtractGroove(action);
        return {
            label: 'Extract groove template',
            inverseAction:
                plan.outcome === 'create'
                    ? { type: 'deleteGrooveTemplate', payload: { templateId: plan.template.id } }
                    : null,
        };
    },
    undoable: true,
});
