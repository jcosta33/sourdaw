import { type ProjectContext } from '../../models/ProjectContext';

import { resolveAgentReference } from './resolveAgentReference';

export type ExplicitlyProtectedClip = { id: string; name: string };
type ProjectClip = ProjectContext['tracks'][number]['clips'][number];

const quotedSpanPattern = /"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;
const protectionPattern = /\b(?:leave|leaving|keep|keeping|preserve|preserving)\s+(.+?)\s+unchanged\b/giu;

function maskQuotedContents(value: string): string {
    return value.replaceAll(quotedSpanPattern, (quoted) => {
        const closingQuote = quoted.at(-1)!;
        return `${quoted[0]!}${' '.repeat(quoted.length - 2)}${closingQuote}`;
    });
}

function getProtectedReferenceTexts(prompt: string): string[] {
    const maskedPrompt = maskQuotedContents(prompt);
    return [...maskedPrompt.matchAll(protectionPattern)].flatMap((match) => {
        if (match.index === undefined || match[1] === undefined) {
            return [];
        }
        const referenceOffset = match[0].indexOf(match[1]);
        const reference = prompt.slice(match.index + referenceOffset, match.index + referenceOffset + match[1].length);
        return reference.trim().length > 0 ? [reference.trim()] : [];
    });
}

function getReservedSelectedClipIds(
    reference: string,
    clips: readonly ProjectClip[],
    context: ProjectContext
): string[] | null {
    if (!/^(?:the\s+)?selected\s+clips?$/iu.test(reference.trim())) {
        return null;
    }
    const selectedIds = new Set([
        ...context.selectedClipIds,
        ...(context.selectedClipId === null ? [] : [context.selectedClipId]),
    ]);
    return clips.filter((clip) => selectedIds.has(clip.id)).map((clip) => clip.id);
}

function resolveProtectedClipIds(reference: string, clips: readonly ProjectClip[], context: ProjectContext): string[] {
    const selectedClipIds = getReservedSelectedClipIds(reference, clips, context);
    if (selectedClipIds !== null) {
        return selectedClipIds;
    }

    const clipIds = new Set(clips.map((clip) => clip.id));
    const resolvedIds = new Set<string>();
    for (const clip of clips) {
        const result = resolveAgentReference({
            prompt: reference,
            assertedId: clip.id,
            capability: 'clip',
            context,
        });
        if (result.status === 'resolved') {
            resolvedIds.add(result.id);
            continue;
        }
        const candidateIds = result.reason === 'ambiguous-target' ? (result.candidateIds ?? []) : [];
        for (const candidateId of candidateIds) {
            if (clipIds.has(candidateId)) {
                resolvedIds.add(candidateId);
            }
        }
    }
    return [...resolvedIds];
}

export function getExplicitlyProtectedClips(prompt: string, context: ProjectContext): ExplicitlyProtectedClip[] {
    const clips = context.tracks.flatMap((track) => track.clips);
    const protectedIds = new Set<string>();

    for (const reference of getProtectedReferenceTexts(prompt)) {
        for (const clipId of resolveProtectedClipIds(reference, clips, context)) {
            protectedIds.add(clipId);
        }
    }

    return clips.filter((clip) => protectedIds.has(clip.id)).map(({ id, name }) => ({ id, name }));
}
