import { getGrooveTemplate } from './getGrooveTemplate';
import { hasSameGrooveContent } from './hasSameGrooveContent';
import { prepareGrooveExtraction } from './prepareGrooveExtraction';
import { resolveGrooveExtractionTemplateId } from './resolveGrooveExtractionTemplateId';

type ResolveGrooveExtractionPinInput = {
    clipId: string;
    sourceName: string;
    subdivision: string;
};

/**
 * What an extraction that names its own template id sends: the id the resolver chose, the extraction read
 * under it, and `template`, the stored template when the resolver reused an existing version. A caller pins
 * that stored template as the action's proposal, because the fresh extraction may carry another name (the
 * name derives from the pool and the clip name) and an explicit id is otherwise compared name-strictly.
 */
export function resolveGrooveExtractionPin({ clipId, sourceName, subdivision }: ResolveGrooveExtractionPinInput) {
    const templateId = resolveGrooveExtractionTemplateId({ clipId, sourceName, subdivision });
    const extraction = prepareGrooveExtraction({ clipId, sourceName, subdivision, templateId });
    const stored = getGrooveTemplate(templateId);
    const reused = extraction.status === 'extracted' && stored && hasSameGrooveContent(stored, extraction.template);
    return { templateId, extraction, template: reused ? structuredClone(stored) : undefined };
}
