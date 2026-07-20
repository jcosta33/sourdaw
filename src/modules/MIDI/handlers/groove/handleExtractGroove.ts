import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { createGrooveTemplate } from '../../useCases/grooveTemplates/createGrooveTemplate';
import { getGrooveTemplate } from '../../useCases/grooveTemplates/getGrooveTemplate';
import { prepareGrooveExtraction } from '../../useCases/grooveTemplates/prepareGrooveExtraction';

type ExtractGrooveAction = Extract<AppAction, { type: 'extractGroove' }>;

type GrooveExtractionActionErrorCode =
    | 'empty-source'
    | 'unsupported-subdivision'
    | 'invalid-source'
    | 'source-revision-mismatch'
    | 'proposal-mismatch'
    | 'template-identity-conflict';
type ExtractedGrooveTemplate = Extract<ReturnType<typeof prepareGrooveExtraction>, { status: 'extracted' }>['template'];

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

function templatesEqual(left: ExtractedGrooveTemplate, right: ExtractedGrooveTemplate): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function planExtractGroove(action: ExtractGrooveAction): ExtractGroovePlan {
    const result = prepareGrooveExtraction({
        clipId: action.payload.clipId,
        sourceName: action.payload.sourceName ?? action.payload.clipId,
        subdivision: action.payload.subdivision ?? '1/16',
        templateId: action.payload.templateId ?? `groove-${action.payload.clipId}-v1`,
    });
    if (action.payload.proposal && action.payload.sourceRevision !== result.sourceRevision) {
        return {
            outcome: 'failure',
            error: new GrooveExtractionActionError(
                'source-revision-mismatch',
                `Groove extraction source changed: ${action.payload.clipId}`
            ),
        };
    }
    if (result.status === 'empty') {
        return {
            outcome: 'failure',
            error: new GrooveExtractionActionError('empty-source', 'Groove extraction rejected: empty-source'),
        };
    }
    if (result.status === 'unsupported') {
        return {
            outcome: 'failure',
            error: new GrooveExtractionActionError(
                'unsupported-subdivision',
                'Groove extraction rejected: unsupported-subdivision'
            ),
        };
    }
    if (result.status === 'invalid-source') {
        return {
            outcome: 'failure',
            error: new GrooveExtractionActionError('invalid-source', 'Groove extraction rejected: invalid-source'),
        };
    }
    if (result.status === 'straight') {
        return { outcome: 'straight' };
    }
    if (action.payload.proposal && !templatesEqual(result.template, action.payload.proposal)) {
        return {
            outcome: 'failure',
            error: new GrooveExtractionActionError(
                'proposal-mismatch',
                `Groove extraction proposal is stale: ${action.payload.clipId}`
            ),
        };
    }
    const template = action.payload.proposal ?? result.template;
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
        if (plan.outcome === 'create') {
            return {
                label: 'Extract groove template',
                inverseAction: { type: 'deleteGrooveTemplate', payload: { templateId: plan.template.id } },
            };
        }
        return {
            label: 'Extract groove template',
            inverseAction: null,
        };
    },
    undoable: true,
});
