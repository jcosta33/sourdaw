import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { hasSameGrooveContent } from './hasSameGrooveContent';
import { prepareGrooveExtraction } from './prepareGrooveExtraction';

type ResolveGrooveExtractionTemplateIdInput = {
    clipId: string;
    sourceName: string;
    subdivision: string;
};

function listExtractionVersions(clipId: string): number[] {
    const prefix = `groove-${clipId}-v`;
    const versions: number[] = [];
    for (const template of grooveTemplateStore.value?.templates ?? []) {
        const suffix = template.id.startsWith(prefix) ? template.id.slice(prefix.length) : '';
        if (/^[1-9]\d*$/.test(suffix)) {
            versions.push(Number(suffix));
        }
    }
    return versions.toSorted((left, right) => left - right);
}

function findLowestFreeVersion(versions: number[]): number {
    let candidate = 1;
    for (const version of versions) {
        if (version === candidate) {
            candidate += 1;
        }
    }
    return candidate;
}

/**
 * The id an extraction that names none creates: the version of this clip whose template already holds
 * exactly this content (the lowest, when several do), otherwise the lowest free `groove-<clipId>-vN`.
 * Callers pin the result so a redo recreates the same id.
 */
export function resolveGrooveExtractionTemplateId({
    clipId,
    sourceName,
    subdivision,
}: ResolveGrooveExtractionTemplateIdInput): string {
    const versions = listExtractionVersions(clipId);
    const lowestFreeId = `groove-${clipId}-v${findLowestFreeVersion(versions)}`;
    for (const version of versions) {
        const candidateId = `groove-${clipId}-v${version}`;
        const result = prepareGrooveExtraction({ clipId, sourceName, subdivision, templateId: candidateId });
        if (result.status !== 'extracted') {
            return `groove-${clipId}-v1`;
        }
        const existing = grooveTemplateStore.value?.templates.find((template) => template.id === candidateId);
        if (existing && hasSameGrooveContent(existing, result.template)) {
            return candidateId;
        }
    }
    return lowestFreeId;
}
