import { valuesEqual } from '#/utils/structuralEquality';

import { type GrooveTemplate } from '../../models/GrooveTemplate';

import { getGrooveTemplate } from './getGrooveTemplate';
import { hasSameGrooveContent } from './hasSameGrooveContent';

type ClassifyGrooveExtractionTemplateInput = {
    /** What extracting the clip's notes under the action's id produces right now. */
    extracted: GrooveTemplate;
    /** The template the action pinned, if it did. */
    proposal: GrooveTemplate | undefined;
    /** Whether the id came from the resolver rather than from the caller or a pin. */
    idChosenByResolver: boolean;
};

type GrooveExtractionTemplateOutcome =
    | { outcome: 'create'; template: GrooveTemplate }
    | { outcome: 'identical' }
    | { outcome: 'diverged'; code: 'proposal-mismatch' | 'template-identity-conflict' };

/** A proposal that is the very template the pool holds under the extraction's id, with the same content. */
function pinsStoredTemplate(proposal: GrooveTemplate, extracted: GrooveTemplate): boolean {
    const stored = getGrooveTemplate(extracted.id);
    return stored !== undefined && valuesEqual(stored, proposal) && hasSameGrooveContent(stored, extracted);
}

/**
 * Decides what an extraction does with the pool once its notes were read: create the template, find it
 * already there, or refuse because the pin or the id no longer matches. A proposal pinning the stored
 * template stays valid when only the derived name moved. An id the resolver chose may hold the same notes
 * under another name; an explicit or pinned id doing so is a collaborator's template and stays a conflict.
 */
export function classifyGrooveExtractionTemplate({
    extracted,
    proposal,
    idChosenByResolver,
}: ClassifyGrooveExtractionTemplateInput): GrooveExtractionTemplateOutcome {
    if (proposal && !valuesEqual(extracted, proposal) && !pinsStoredTemplate(proposal, extracted)) {
        return { outcome: 'diverged', code: 'proposal-mismatch' };
    }
    const template = proposal ?? extracted;
    const existing = getGrooveTemplate(template.id);
    if (!existing) {
        return { outcome: 'create', template };
    }
    if (valuesEqual(existing, template) || (idChosenByResolver && hasSameGrooveContent(existing, template))) {
        return { outcome: 'identical' };
    }
    return { outcome: 'diverged', code: 'template-identity-conflict' };
}
