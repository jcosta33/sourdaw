import { valuesEqual } from '#/utils/structuralEquality';

import { getGrooveTemplate } from './getGrooveTemplate';
import { prepareGrooveExtraction } from './prepareGrooveExtraction';

type ResolveGrooveExtractionTemplateIdInput = {
    clipId: string;
    sourceName: string;
    subdivision: string;
};

const MAX_EXTRACTION_VERSIONS = 10_000;

/**
 * The id an extraction that names none creates: `groove-<clipId>-v1` for the clip's first extraction,
 * the same id again when that template already holds exactly this content, otherwise the lowest
 * `-vN` that is free or holds it. Callers pin the result so a redo recreates the same id.
 */
export function resolveGrooveExtractionTemplateId({
    clipId,
    sourceName,
    subdivision,
}: ResolveGrooveExtractionTemplateIdInput): string {
    const firstId = `groove-${clipId}-v1`;
    for (let version = 1; version <= MAX_EXTRACTION_VERSIONS; version += 1) {
        const candidateId = version === 1 ? firstId : `groove-${clipId}-v${version}`;
        const existing = getGrooveTemplate(candidateId);
        if (!existing) {
            return candidateId;
        }
        const result = prepareGrooveExtraction({ clipId, sourceName, subdivision, templateId: candidateId });
        if (result.status !== 'extracted') {
            return firstId;
        }
        if (valuesEqual(existing, result.template)) {
            return candidateId;
        }
    }
    return firstId;
}
