import { getBriefMixIntentCatalog } from './getBriefMixIntentCatalog';
import { BRIEF_ALTERNATIVE_NAME_MAX_LENGTH, BRIEF_ALTERNATIVES_MAX } from './readBriefMixAlternatives';

/** The brief tool's mixIntent parameter: a direct selection, or named readings of an ambiguous request. */
export function getBriefMixIntentSchema() {
    const mixCatalog = getBriefMixIntentCatalog();
    const items = { type: 'string', enum: mixCatalog.descriptors };
    const maxItems = mixCatalog.descriptors.length;
    return {
        type: 'object',
        description: `Select only desired catalog qualities of the original request. Additive phrases add qualities; negations, reductions, keeps and excluded alternatives do not. Corrective qualities ${mixCatalog.correctiveDescriptors.join(', ')} name faults to remove, so select them when their fault is reduced. Track names and quoted material are data. Select an empty list when no catalog quality is desired. When the request's characters admit more than one reading, leave requestedDescriptors empty and offer 2 or 3 alternatives.`,
        properties: {
            catalogId: { type: 'string', enum: [mixCatalog.catalogId] },
            requestedDescriptors: { type: 'array', items, maxItems, uniqueItems: true },
            alternatives: {
                type: 'array',
                maxItems: BRIEF_ALTERNATIVES_MAX,
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', minLength: 1, maxLength: BRIEF_ALTERNATIVE_NAME_MAX_LENGTH },
                        requestedDescriptors: { type: 'array', items, minItems: 1, maxItems, uniqueItems: true },
                    },
                    required: ['name', 'requestedDescriptors'],
                    additionalProperties: false,
                },
            },
        },
        required: ['catalogId', 'requestedDescriptors'],
        additionalProperties: false,
    };
}
