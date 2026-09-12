import { type ProjectContext } from '../../../models/ProjectContext';

import { escapeRegExp } from './escapeRegExp';
import { normalizePromptText } from './normalizePromptText';

const reservedVcaGroupReferenceWords: ReadonlySet<string> = new Set(['group', 'vca', 'vca group']);

function getProjectReferenceTexts(context: ProjectContext): string[] {
    const vcaReferences = (context.vcaGroups ?? [])
        .flatMap((group) => [group.id, group.name])
        .filter((reference) => !reservedVcaGroupReferenceWords.has(normalizePromptText(reference)));
    const references = [
        ...vcaReferences,
        ...context.tracks.flatMap((track) => [
            track.id,
            track.name,
            ...track.devices.flatMap((device) => [
                device.id,
                device.type,
                ...(device.parameters ?? []).flatMap((parameter) => [parameter.id, parameter.name]),
            ]),
            ...track.clips.flatMap((clip) => [clip.id, clip.name]),
        ]),
    ];
    return [...new Set(references)]
        .filter((reference) => reference.length > 0)
        .sort((left, right) => right.length - left.length);
}

const reservedClipReferenceWords: ReadonlySet<string> = new Set([
    'track',
    'clip',
    'device',
    'bus',
    'master',
    'output',
    'send',
    'parameter',
    'remove',
    'delete',
    'rename',
    'duplicate',
    'copy',
    'trim',
    'start',
    'end',
    'nudge',
    'gain',
    'volume',
]);

function getSemanticClipReferenceTexts(context: ProjectContext): string[] {
    const clipReferences = context.tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.id, clip.name]));
    return [...new Set(clipReferences)]
        .filter((reference) => reference.length >= 'clip'.length)
        .filter((reference) => !reservedClipReferenceWords.has(normalizePromptText(reference)))
        .sort((left, right) => right.length - left.length);
}

type ProjectReferenceMaskSpan = {
    end: number;
    replacement: string;
    start: number;
};

function collectProjectReferenceMaskSpans(
    prompt: string,
    references: readonly string[],
    spans: ProjectReferenceMaskSpan[],
    getReplacement: (match: string, end: number) => string
): void {
    for (const reference of references) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(reference)}(?![\\p{L}\\p{N}])`, 'giu');
        for (const match of prompt.matchAll(pattern)) {
            const start = match.index;
            const value = match[0];
            if (start === undefined || !value) {
                continue;
            }
            const end = start + value.length;
            if (spans.some((span) => start < span.end && end > span.start)) {
                continue;
            }
            spans.push({ start, end, replacement: getReplacement(value, end) });
        }
    }
}

export function maskProjectReferences(prompt: string, context: ProjectContext): string {
    const spans: ProjectReferenceMaskSpan[] = [];
    collectProjectReferenceMaskSpans(prompt, getSemanticClipReferenceTexts(context), spans, (match, end) => {
        const explicitEntitySuffix = /^\s+(?:clip|track|device|bus|master|output|send|parameter)\b/iu.test(
            prompt.slice(end)
        );
        return explicitEntitySuffix ? '□'.repeat(match.length) : `clip${'□'.repeat(match.length - 'clip'.length)}`;
    });
    collectProjectReferenceMaskSpans(prompt, getProjectReferenceTexts(context), spans, (match) =>
        '□'.repeat(match.length)
    );

    let maskedPrompt = '';
    let cursor = 0;
    for (const span of spans.toSorted((left, right) => left.start - right.start)) {
        maskedPrompt += prompt.slice(cursor, span.start);
        maskedPrompt += span.replacement;
        cursor = span.end;
    }
    return maskedPrompt + prompt.slice(cursor);
}
