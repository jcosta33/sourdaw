import { type GrooveTemplate } from '../../models/GrooveTemplate';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { hasSameGrooveContent } from './hasSameGrooveContent';
import { prepareGrooveExtraction } from './prepareGrooveExtraction';

type ResolveGrooveExtractionTemplateIdInput = {
    clipId: string;
    sourceName: string;
    subdivision: string;
};

type ExtractionVersion = { version: number; template: GrooveTemplate };

function listExtractionVersions(clipId: string): ExtractionVersion[] {
    const prefix = `groove-${clipId}-v`;
    const versions: ExtractionVersion[] = [];
    for (const template of grooveTemplateStore.value?.templates ?? []) {
        const suffix = template.id.startsWith(prefix) ? template.id.slice(prefix.length) : '';
        if (/^[1-9]\d*$/.test(suffix)) {
            versions.push({ version: Number(suffix), template });
        }
    }
    return versions.toSorted((left, right) => left.version - right.version);
}

function findLowestFreeVersion(versions: ExtractionVersion[]): number {
    let candidate = 1;
    for (const { version } of versions) {
        if (version === candidate) {
            candidate += 1;
        }
    }
    return candidate;
}

/**
 * The id an extraction that names none creates: the version of this clip whose template already holds
 * exactly this content (the lowest, when several do), otherwise the lowest free `groove-<clipId>-vN`.
 * Notes that extract no template (straight, empty, unsupported, unreadable) yield no id: their callers
 * select or report the straight groove, never a version of this clip. Callers pin the result so a redo
 * recreates the same id.
 */
export function resolveGrooveExtractionTemplateId({
    clipId,
    sourceName,
    subdivision,
}: ResolveGrooveExtractionTemplateIdInput): { status: 'extracted'; templateId: string } | { status: 'not-extracted' } {
    const versions = listExtractionVersions(clipId);
    const freeId = `groove-${clipId}-v${findLowestFreeVersion(versions)}`;
    const result = prepareGrooveExtraction({ clipId, sourceName, subdivision, templateId: freeId });
    if (result.status !== 'extracted') {
        return { status: 'not-extracted' };
    }
    for (const { template } of versions) {
        if (hasSameGrooveContent(template, { ...result.template, id: template.id })) {
            return { status: 'extracted', templateId: template.id };
        }
    }
    return { status: 'extracted', templateId: freeId };
}
