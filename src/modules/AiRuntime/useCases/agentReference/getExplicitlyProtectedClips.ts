import { type ProjectContext } from '../../models/ProjectContext';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';
import { getSelectedClipReferenceIds } from '../../transformers/promptParser/selectedClipReference';

import { resolveAgentReference } from './resolveAgentReference';

export type ExplicitlyProtectedClip = { id: string; name: string };
export type ExplicitClipProtection = {
    clips: ExplicitlyProtectedClip[];
    complete: boolean;
};
type ProjectClip = ProjectContext['tracks'][number]['clips'][number];

const protectionVerb = String.raw`(?:leave|leaving|keep|keeping|preserve|preserving)`;
const protectionPattern = new RegExp(String.raw`\b${protectionVerb}\s+(.+?)\s+unchanged\b`, 'giu');
const emptyProtectionPattern = new RegExp(String.raw`\b${protectionVerb}\s+unchanged\b`, 'iu');
const protectionVerbPattern = new RegExp(String.raw`\b${protectionVerb}\b`, 'iu');
const referenceSeparatorPattern = /,\s*(?:and\b\s*)?|\s+and\s+/giu;

type ProtectedReferenceParse = {
    complete: boolean;
    references: string[];
};

function splitProtectedReferenceList(reference: string): ProtectedReferenceParse {
    const quoteScan = scanPromptQuotedText(reference);
    const maskedReference = quoteScan.maskedText.trim();
    if (!quoteScan.complete || /^and\b|\band$/iu.test(maskedReference)) {
        return { complete: false, references: [] };
    }

    const references: string[] = [];
    let start = 0;
    for (const separator of quoteScan.maskedText.matchAll(referenceSeparatorPattern)) {
        if (separator.index === undefined) {
            continue;
        }
        const item = reference.slice(start, separator.index).trim();
        if (item.length === 0 || /^and\b|\band$/iu.test(scanPromptQuotedText(item).maskedText.trim())) {
            return { complete: false, references: [] };
        }
        references.push(item);
        start = separator.index + separator[0].length;
    }
    const finalItem = reference.slice(start).trim();
    if (finalItem.length === 0 || /^and\b|\band$/iu.test(scanPromptQuotedText(finalItem).maskedText.trim())) {
        return { complete: false, references: [] };
    }
    references.push(finalItem);
    return { complete: true, references };
}

function getProtectedReferenceTexts(prompt: string): ProtectedReferenceParse {
    const quoteScan = scanPromptQuotedText(prompt);
    const references: string[] = [];
    let complete = !emptyProtectionPattern.test(quoteScan.maskedText);

    for (const match of quoteScan.maskedText.matchAll(protectionPattern)) {
        if (match.index === undefined || match[1] === undefined) {
            continue;
        }
        const referenceOffset = match[0].indexOf(match[1]);
        const reference = prompt.slice(match.index + referenceOffset, match.index + referenceOffset + match[1].length);
        const parsed = splitProtectedReferenceList(reference);
        complete &&= parsed.complete;
        const trimmedWholeReference = reference.trim();
        if (trimmedWholeReference.length > 0) {
            references.push(trimmedWholeReference);
        }
        references.push(...parsed.references);
    }

    if (!quoteScan.complete && protectionVerbPattern.test(quoteScan.maskedText)) {
        complete = false;
    }
    return { complete, references: [...new Set(references)] };
}

function getReservedSelectedClipIds(
    reference: string,
    clips: readonly ProjectClip[],
    context: ProjectContext
): string[] | null {
    if (!/^(?:the\s+)?selected\s+clips?$/iu.test(reference.trim())) {
        return null;
    }
    const selectedIds = new Set(getSelectedClipReferenceIds(context));
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

export function getExplicitClipProtection(prompt: string, context: ProjectContext): ExplicitClipProtection {
    const clips = context.tracks.flatMap((track) => track.clips);
    const parsedReferences = getProtectedReferenceTexts(prompt);
    const protectedIds = new Set<string>();

    for (const reference of parsedReferences.references) {
        for (const clipId of resolveProtectedClipIds(reference, clips, context)) {
            protectedIds.add(clipId);
        }
    }

    return {
        clips: clips.filter((clip) => protectedIds.has(clip.id)).map(({ id, name }) => ({ id, name })),
        complete: parsedReferences.complete,
    };
}
