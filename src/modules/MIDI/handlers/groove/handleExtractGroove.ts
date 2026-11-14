import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { GrooveExtractionActionError } from '../../errors/GrooveExtractionActionError';
import { createGrooveTemplate } from '../../useCases/grooveTemplates/createGrooveTemplate';
import { getGrooveSourceClipName } from '../../useCases/grooveTemplates/getGrooveSourceClipName';
import { getGrooveTemplate } from '../../useCases/grooveTemplates/getGrooveTemplate';
import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { prepareGrooveExtraction } from '../../useCases/grooveTemplates/prepareGrooveExtraction';

import { isExtractGrooveSessionEntry, isMaterializedExtractGroovePayload } from './validateExtractGrooveCommand';

type ExtractGrooveAction = Extract<AppAction, { type: 'extractGroove' }>;

type ExtractedGrooveTemplate = Extract<ReturnType<typeof prepareGrooveExtraction>, { status: 'extracted' }>['template'];

type ExtractGroovePlan =
    | { outcome: 'create'; template: ExtractedGrooveTemplate }
    | { outcome: 'straight' }
    | { outcome: 'identical' }
    // A request no project state could satisfy (no notes, an unsupported grid, an unreadable clip).
    | { outcome: 'failure'; error: GrooveExtractionActionError }
    // The project moved under the extraction: its clip notes changed since it was pinned, or its
    // template id now holds other content. A refusal the caller can retry or report, as every other
    // replay reports its divergence, never a handler failure that would wedge a redo.
    | {
          outcome: 'diverged';
          code: 'source-revision-mismatch' | 'proposal-mismatch' | 'template-identity-conflict';
      };

function templatesEqual(left: ExtractedGrooveTemplate, right: ExtractedGrooveTemplate): boolean {
    return valuesEqual(left, right);
}

function planExtractGroove(action: ExtractGrooveAction): ExtractGroovePlan {
    const result = prepareGrooveExtraction({
        clipId: action.payload.clipId,
        sourceName: action.payload.sourceName ?? action.payload.clipId,
        subdivision: action.payload.subdivision ?? '1/16',
        templateId: action.payload.templateId ?? `groove-${action.payload.clipId}-v1`,
    });
    if (action.payload.proposal && action.payload.sourceRevision !== result.sourceRevision) {
        return { outcome: 'diverged', code: 'source-revision-mismatch' };
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
        return { outcome: 'diverged', code: 'proposal-mismatch' };
    }
    const template = action.payload.proposal ?? result.template;
    const existing = getGrooveTemplate(template.id);
    if (!existing) {
        return { outcome: 'create', template };
    }
    if (templatesEqual(existing, template)) {
        return { outcome: 'identical' };
    }
    return { outcome: 'diverged', code: 'template-identity-conflict' };
}

/**
 * Pins the template this extraction creates and the note revision it read, so the recorded action,
 * its saved undo entry and a compiled command all name the template execution will create, and a
 * redo or a late execution refuses rather than extracting from notes edited since.
 */
function pinExtraction(action: ExtractGrooveAction): void {
    if (action.payload.proposal !== undefined) {
        return;
    }
    const result = prepareGrooveExtraction({
        clipId: action.payload.clipId,
        sourceName: action.payload.sourceName ?? action.payload.clipId,
        subdivision: action.payload.subdivision ?? '1/16',
        templateId: action.payload.templateId ?? `groove-${action.payload.clipId}-v1`,
    });
    if (result.status !== 'extracted') {
        return;
    }
    action.payload = { ...action.payload, proposal: result.template, sourceRevision: result.sourceRevision };
}

export const handleExtractGroove = createHandler<'extractGroove'>({
    validateSessionEntry: isExtractGrooveSessionEntry,
    validateMaterializedCommandArguments: isMaterializedExtractGroovePayload,
    materializeCommandArguments: (action) => {
        if (action.payload.sourceName === undefined) {
            const clipName = getGrooveSourceClipName(action.payload.clipId);
            if (clipName !== null) {
                action.payload = { ...action.payload, sourceName: clipName };
            }
        }
        pinExtraction(action);
    },
    isNoop: (action) => {
        const plan = planExtractGroove(action);
        return plan.outcome === 'straight' || plan.outcome === 'identical';
    },
    execute: (action) => {
        const plan = planExtractGroove(action);
        if (plan.outcome === 'diverged') {
            return { status: 'conflict', reason: plan.code };
        }
        if (plan.outcome === 'failure') {
            throw plan.error;
        }
        if (plan.outcome === 'create') {
            const result = createGrooveTemplate(plan.template);
            if (result.status === 'no-write') {
                return { status: 'no-write' };
            }
            return {
                status: 'written',
                afterCommit: markGrooveTemplateProjectWrite,
                afterAmbiguousCommit: markGrooveTemplateProjectWrite,
            };
        }
        return { status: 'no-write' };
    },
    describe: (action) => {
        pinExtraction(action);
        const plan = planExtractGroove(action);
        if (plan.outcome === 'create') {
            return {
                label: 'Extract groove template',
                inverseAction: {
                    type: 'deleteGrooveTemplate',
                    payload: { templateId: plan.template.id, expectedTemplate: structuredClone(plan.template) },
                },
            };
        }
        return {
            label: 'Extract groove template',
            inverseAction: null,
        };
    },
    undoable: true,
});
