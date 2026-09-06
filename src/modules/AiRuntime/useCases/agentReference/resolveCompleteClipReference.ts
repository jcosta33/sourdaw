import { type ProjectContext } from '../../models/ProjectContext';
import { maskQuotedTextContents } from '../../transformers/promptParser/promptQuotedText';
import { getSelectedClipReferenceIds } from '../../transformers/promptParser/selectedClipReference';

import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';
import {
    resolveAgentReference,
    type ResolveAgentReferenceInput,
    type ResolveAgentReferenceResult,
} from './resolveAgentReference';

type ResolveCompleteClipReferenceInput = ResolveAgentReferenceInput & {
    referenceText: string;
};

function fullyAccountsForClipReference(referenceText: string, clipId: string, context: ProjectContext): boolean {
    const owningTrack = context.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
    const clip = owningTrack?.clips.find((candidate) => candidate.id === clipId);
    if (!clip || !owningTrack) {
        return false;
    }

    const normalizedReference = normalizeAgentReferenceText(referenceText);
    const clipReferences = [clip.id, clip.name].map(normalizeAgentReferenceText);
    if (clipReferences.includes(normalizedReference)) {
        return true;
    }

    const normalizedUnquotedReference = normalizeAgentReferenceText(maskQuotedTextContents(referenceText));
    if (/^(?:the )?(?:selected|current|this)(?: audio|midi)? clip$/u.test(normalizedUnquotedReference)) {
        return getSelectedClipReferenceIds(context).includes(clipId);
    }

    const ownerReferences = [owningTrack.id, owningTrack.name].map(normalizeAgentReferenceText);
    return clipReferences.some((clipReference) =>
        ownerReferences.some((ownerReference) =>
            ['on', 'in', 'from'].some((qualifier) =>
                [
                    `${clipReference} ${qualifier} ${ownerReference}`,
                    `${clipReference} ${qualifier} the ${ownerReference}`,
                    `${clipReference} ${qualifier} ${ownerReference} track`,
                    `${clipReference} ${qualifier} the ${ownerReference} track`,
                ].includes(normalizedReference)
            )
        )
    );
}

export function resolveCompleteClipReference(input: ResolveCompleteClipReferenceInput): ResolveAgentReferenceResult {
    const result = resolveAgentReference(input);
    if (result.status === 'resolved') {
        return fullyAccountsForClipReference(input.referenceText, result.id, input.context)
            ? result
            : { status: 'rejected', reason: 'ungrounded-target' };
    }
    if (result.reason !== 'ambiguous-target') {
        return result;
    }

    const completeCandidateIds = (result.candidateIds ?? []).filter((candidateId) =>
        fullyAccountsForClipReference(input.referenceText, candidateId, input.context)
    );
    if (completeCandidateIds.length === 0) {
        return { status: 'rejected', reason: 'ungrounded-target' };
    }
    if (completeCandidateIds.length > 1) {
        return { status: 'rejected', reason: 'ambiguous-target', candidateIds: completeCandidateIds };
    }
    const candidateId = completeCandidateIds[0]!;
    return resolveAgentReference({
        assertedId: input.assertedId,
        capability: input.capability,
        context: input.context,
        dependencyId: input.dependencyId,
        excludedIds: [...(input.excludedIds ?? []), ...(result.candidateIds ?? []).filter((id) => id !== candidateId)],
        prompt: input.prompt,
    });
}
