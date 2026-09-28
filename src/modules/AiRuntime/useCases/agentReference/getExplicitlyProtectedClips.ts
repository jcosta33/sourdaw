import { type ProjectContext } from '../../models/ProjectContext';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';
import { getSelectedClipReferenceIds } from '../../transformers/promptParser/selectedClipReference';

import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { resolveAgentReference } from './resolveAgentReference';

export type ExplicitlyProtectedClip = { id: string; name: string };
export type ExplicitClipProtection = {
    clips: ExplicitlyProtectedClip[];
    complete: boolean;
};
type ProjectClip = ProjectContext['tracks'][number]['clips'][number];

const protectionVerb = String.raw`(?:leave|leaving|keep|keeping|preserve|preserving)`;
const protectionClauseBoundary = String.raw`(?:;|[.!?](?=\s|$))`;
const protectionReferenceCharacter = String.raw`(?:(?!${protectionClauseBoundary})[\s\S])`;
const protectionPattern = new RegExp(
    String.raw`\b${protectionVerb}\s+(${protectionReferenceCharacter}+?)\s+unchanged\b`,
    'giu'
);
const exclusionPattern = new RegExp(
    String.raw`\b(?:excluding|except)\s+(${protectionReferenceCharacter}+?)(?=${protectionClauseBoundary}|,\s*(?=(?:(?:and\s+)?then\s+)?(?:set|change|adjust|add|create|make|mute|remove|delete)\b)|\s+(?=(?:and\s+)?then\s+(?:set|change|adjust|add|create|make|mute|remove|delete)\b)|$)`,
    'giu'
);
const emptyProtectionPattern = new RegExp(String.raw`\b${protectionVerb}\s+unchanged\b`, 'iu');
const protectionVerbPattern = new RegExp(String.raw`\b${protectionVerb}\b`, 'iu');
const allProtectionVerbsPattern = new RegExp(String.raw`\b${protectionVerb}\b`, 'giu');
const exclusionVerbPattern = /\b(?:excluding|except)\b/giu;
const protectionClauseBoundaryPattern = new RegExp(protectionClauseBoundary, 'giu');
const referenceSeparatorPattern = /,\s*(?:and\b\s*)?|\s+and\s+/giu;

type ProtectedReferenceParse = {
    complete: boolean;
    references: { whole: string; members: string[] }[];
};
type ReferenceListParse = { complete: boolean; references: string[] };

function hasDanglingProtectionClause(maskedPrompt: string, completeVerbStarts: ReadonlySet<number>): boolean {
    const boundaries = [...maskedPrompt.matchAll(protectionClauseBoundaryPattern)];
    for (const verb of maskedPrompt.matchAll(allProtectionVerbsPattern)) {
        if (completeVerbStarts.has(verb.index)) {
            continue;
        }
        const precedingBoundary = boundaries.findLast((boundary) => boundary.index + boundary[0].length <= verb.index);
        const clauseStart = precedingBoundary ? precedingBoundary.index + precedingBoundary[0].length : 0;
        const prefix = maskedPrompt.slice(clauseStart, verb.index).trim();
        if (prefix.length === 0 || /\b(?:and|then)\s*$/iu.test(prefix)) {
            return true;
        }
    }
    return false;
}

function splitProtectedReferenceList(reference: string): ReferenceListParse {
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
    const references: ProtectedReferenceParse['references'] = [];
    let complete = !emptyProtectionPattern.test(quoteScan.maskedText);
    const completeVerbStarts = new Set<number>();
    const completeExclusionStarts = new Set<number>();

    for (const match of [
        ...quoteScan.maskedText.matchAll(protectionPattern),
        ...quoteScan.maskedText.matchAll(exclusionPattern),
    ]) {
        if (match.index === undefined || match[1] === undefined) {
            continue;
        }
        if (/^(?:leave|leaving|keep|keeping|preserve|preserving)\b/iu.test(match[0])) {
            completeVerbStarts.add(match.index);
        } else {
            completeExclusionStarts.add(match.index);
        }
        const referenceOffset = match[0].indexOf(match[1]);
        const reference = prompt.slice(match.index + referenceOffset, match.index + referenceOffset + match[1].length);
        const parsed = splitProtectedReferenceList(reference);
        complete &&= parsed.complete;
        const trimmedWholeReference = reference.trim();
        if (trimmedWholeReference.length > 0) {
            references.push({ whole: trimmedWholeReference, members: parsed.references });
        }
    }

    complete &&= !hasDanglingProtectionClause(quoteScan.maskedText, completeVerbStarts);
    complete &&= [...quoteScan.maskedText.matchAll(exclusionVerbPattern)].every((match) =>
        completeExclusionStarts.has(match.index)
    );
    if (!quoteScan.complete && protectionVerbPattern.test(quoteScan.maskedText)) {
        complete = false;
    }
    return { complete, references };
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

    let complete = parsedReferences.complete;
    for (const { whole, members } of parsedReferences.references) {
        const wholeIds = resolveProtectedClipIds(whole, clips, context);
        for (const clipId of wholeIds) {
            protectedIds.add(clipId);
        }
        const wholeIsLiteralName =
            wholeIds.length === 1 &&
            clips.some(
                (clip) =>
                    clip.id === wholeIds[0] &&
                    (normalizePromptText(whole) === normalizePromptText(clip.name) || whole === clip.id)
            );
        if (wholeIsLiteralName) {
            continue;
        }
        for (const member of members) {
            const memberIds = resolveProtectedClipIds(member, clips, context);
            complete &&= memberIds.length > 0;
            for (const clipId of memberIds) {
                protectedIds.add(clipId);
            }
        }
    }

    return {
        clips: clips.filter((clip) => protectedIds.has(clip.id)).map(({ id, name }) => ({ id, name })),
        complete,
    };
}
