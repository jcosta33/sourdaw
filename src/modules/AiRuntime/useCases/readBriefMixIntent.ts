import { getBriefMixIntentCatalog } from './getBriefMixIntentCatalog';

type MixDescriptor = ReturnType<typeof getBriefMixIntentCatalog>['descriptors'][number];

export function readBriefMixIntent(
    value: unknown
): { catalogId: string; requestedDescriptors: readonly MixDescriptor[] } | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const entries = Object.entries(value);
    if (entries.length !== 2 || entries.some(([key]) => key !== 'catalogId' && key !== 'requestedDescriptors')) {
        return null;
    }
    const catalog = getBriefMixIntentCatalog();
    const fields = Object.fromEntries(entries);
    if (fields.catalogId !== catalog.catalogId || !Array.isArray(fields.requestedDescriptors)) {
        return null;
    }
    const descriptors = fields.requestedDescriptors;
    if (descriptors.length > catalog.descriptors.length || new Set(descriptors).size !== descriptors.length) {
        return null;
    }
    const selected: MixDescriptor[] = [];
    for (const value of descriptors) {
        const descriptor = catalog.descriptors.find((candidate) => candidate === value);
        if (descriptor === undefined) {
            return null;
        }
        selected.push(descriptor);
    }
    return { catalogId: catalog.catalogId, requestedDescriptors: selected };
}
