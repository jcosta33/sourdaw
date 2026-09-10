import { type getAppActionExecutionPolicy } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { maskQuotedTextContents } from '../../transformers/promptParser/promptQuotedText';
import { getSelectedClipReferenceIds } from '../../transformers/promptParser/selectedClipReference';

import { getAgentReferenceCapabilityKind } from './agentReferenceCapabilityKinds';
import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import {
    isAgentReferenceCapabilityCandidate,
    type AgentReferenceCapability,
} from './isAgentReferenceCapabilityCandidate';
import { levenshteinDistance } from './levenshteinDistance';
import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';

type AppActionRisk = ReturnType<typeof getAppActionExecutionPolicy>['risk'];

export type ResolveAgentReferenceInput = {
    prompt: string;
    assertedId: unknown;
    capability: AgentReferenceCapability;
    context: ProjectContext;
    dependencyId?: string;
    excludedIds?: readonly string[];
    risk?: AppActionRisk;
};

/** One project object the prompt could be naming, drawn from the capability's collection. */
type CapabilityCandidate = {
    id: string;
    name: string;
    ownerQualified: boolean;
};

type AgentReferenceEvidence = 'literal-id' | 'exact-name' | 'selection' | 'owner-qualified' | 'fuzzy-name';

type TieredEvidence = Exclude<AgentReferenceEvidence, 'fuzzy-name'>;

type ReferenceCandidate = {
    id: string;
    name: string;
    confidence: number;
    evidence: readonly AgentReferenceEvidence[];
};

export type ResolveAgentReferenceResult =
    | {
          status: 'resolved';
          id: string;
          evidence: AgentReferenceEvidence;
          confidence: number;
          candidates: readonly ReferenceCandidate[];
      }
    | {
          status: 'rejected';
          reason: 'ungrounded-target' | 'ambiguous-target' | 'asserted-target-mismatch' | 'low-confidence-target';
          candidateIds?: string[];
          candidates: readonly ReferenceCandidate[];
          requirement?: 'clarification' | 'explicit-preview';
      };

/** Confidence a binding needs before an interpretation may act without the caller confirming it. */
const MIN_BINDING_CONFIDENCE = 0.75;

const EVIDENCE_CONFIDENCE: Readonly<Record<TieredEvidence, number>> = {
    'literal-id': 1,
    'exact-name': 0.9,
    selection: 0.85,
    'owner-qualified': 0.8,
};

/** Keeps every fuzzy reading below MIN_BINDING_CONFIDENCE, so a typo never binds a gated effect. */
const FUZZY_NAME_CONFIDENCE_FACTOR = 0.7;
const MIN_FUZZY_NAME_SIMILARITY = 0.8;
const MIN_FUZZY_NAME_LENGTH = 4;

/** Risks whose effect the user cannot cheaply inspect and undo, so a weak or multi-match reading must not act. */
const GATED_RISKS: ReadonlySet<AppActionRisk> = new Set<AppActionRisk>([
    'broad-reversible',
    'destructive-reversible',
    'authority-sensitive',
    'external-effect',
    'unclassified',
]);

const NO_RESERVED_REFERENCE_WORDS: ReadonlySet<string> = new Set();

const reservedVcaGroupReferenceWords: ReadonlySet<string> = new Set(['group', 'vca', 'vca group']);
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
    'normalize',
    'normalise',
    'peak',
    'rms',
    'lufs',
]);

function foldReferenceMarks(value: string): string {
    return value.normalize('NFKD').toLocaleLowerCase().replaceAll(/\p{M}/gu, '');
}

function containsExactPhrase(prompt: string, reference: string): boolean {
    return getExactPhraseRanges(prompt, reference).length > 0;
}

function getTokenReferenceRanges(
    prompt: string,
    reference: string,
    tokenJoiner: string
): readonly { end: number; start: number }[] {
    const tokens = normalizeAgentReferenceText(reference)
        .split(' ')
        .filter((token) => token.length > 0);
    if (tokens.length === 0) {
        return [];
    }
    const needle = tokens.map((token) => escapeRegExp(token)).join(tokenJoiner);
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${needle}(?![\\p{L}\\p{N}])`, 'giu');
    return [...prompt.matchAll(pattern)].flatMap((match) => {
        if (match.index === undefined) {
            return [];
        }
        return [{ start: match.index, end: match.index + match[0].length }];
    });
}

function getContiguousReferenceRanges(prompt: string, reference: string): readonly { end: number; start: number }[] {
    return getTokenReferenceRanges(prompt, reference, '[-_]+');
}

function getExactNameOverlapRanges(prompt: string, reference: string): readonly { end: number; start: number }[] {
    return getTokenReferenceRanges(foldReferenceMarks(prompt), reference, '[^\\p{L}\\p{N}]+');
}

function getExactPhraseRanges(prompt: string, reference: string): readonly { end: number; start: number }[] {
    const normalizedReference = normalizeAgentReferenceText(reference);
    if (normalizedReference.length === 0) {
        return [];
    }
    const haystack = ` ${normalizeAgentReferenceText(prompt)} `;
    const needle = ` ${normalizedReference} `;
    const ranges: { end: number; start: number }[] = [];
    let from = 0;
    while (from < haystack.length) {
        const index = haystack.indexOf(needle, from);
        if (index < 0) {
            break;
        }
        ranges.push({ start: index, end: index + needle.length });
        from = index + 1;
    }
    return ranges;
}

function containsQualifiedMasterOutputReference(prompt: string): boolean {
    const normalized = normalizeAgentReferenceText(prompt);
    return /\b(?:to|into|through) (?:the )?master\b|\bmaster (?:bus|channel|output)\b/u.test(normalized);
}

function containsQualifiedVcaGroupReference(prompt: string, reference: string): boolean {
    const normalizedPrompt = ` ${normalizeAgentReferenceText(prompt)} `;
    const normalizedReference = normalizeAgentReferenceText(reference);
    return [
        ` for ${normalizedReference} `,
        ` for the ${normalizedReference} `,
        ` on ${normalizedReference} `,
        ` on the ${normalizedReference} `,
        ` from ${normalizedReference} `,
        ` from the ${normalizedReference} `,
        ` to ${normalizedReference} `,
        ` to the ${normalizedReference} `,
        ` into ${normalizedReference} `,
        ` into the ${normalizedReference} `,
    ].some((qualifiedReference) => normalizedPrompt.includes(qualifiedReference));
}

function hasExplicitTrackSelection(prompt: string): boolean {
    const normalized = normalizeAgentReferenceText(maskQuotedTextContents(prompt));
    return /\b(?:selected|current|this) (?:audio |midi |bus |folder )?track\b/u.test(normalized);
}

function hasExplicitClipSelection(prompt: string): boolean {
    const normalized = normalizeAgentReferenceText(maskQuotedTextContents(prompt));
    return /\b(?:selected|current|this) (?:audio |midi )?clip\b/u.test(normalized);
}

function containsQualifiedClipReference(prompt: string, reference: string): boolean {
    const normalizedPrompt = ` ${normalizeAgentReferenceText(prompt)} `;
    const normalizedReference = normalizeAgentReferenceText(reference);
    return (
        normalizedPrompt.includes(` ${normalizedReference} clip `) ||
        normalizedPrompt.includes(` clip ${normalizedReference} `)
    );
}

type TrackOwnerReference = { status: 'none' } | { status: 'unique'; id: string } | { status: 'ambiguous' };

function containsQualifiedTrackOwnerReference(prompt: string, reference: string): boolean {
    const normalizedPrompt = ` ${normalizeAgentReferenceText(prompt)} `;
    const normalizedReference = normalizeAgentReferenceText(reference);
    return [
        ` on ${normalizedReference} `,
        ` on the ${normalizedReference} `,
        ` in ${normalizedReference} `,
        ` in the ${normalizedReference} `,
        ` from ${normalizedReference} `,
        ` from the ${normalizedReference} `,
    ].some((qualifiedReference) => normalizedPrompt.includes(qualifiedReference));
}

function namesTrackAsQualifiedOwner(prompt: string, track: { id: string; name: string }): boolean {
    return (
        containsQualifiedTrackOwnerReference(prompt, track.id) ||
        containsQualifiedTrackOwnerReference(prompt, track.name)
    );
}

function resolveTrackOwnerReference(prompt: string, context: ProjectContext): TrackOwnerReference {
    const referencedTracks = context.tracks.filter((track) => namesTrackAsQualifiedOwner(prompt, track));
    if (referencedTracks.length === 0) {
        return { status: 'none' };
    }
    if (referencedTracks.length > 1) {
        return { status: 'ambiguous' };
    }
    return { status: 'unique', id: referencedTracks[0]!.id };
}

function hasNonClipReferenceCollision(
    clip: ProjectContext['tracks'][number]['clips'][number],
    context: ProjectContext
): boolean {
    const clipReferences = new Set([normalizeAgentReferenceText(clip.id), normalizeAgentReferenceText(clip.name)]);
    return context.tracks.some(
        (track) =>
            clipReferences.has(normalizeAgentReferenceText(track.id)) ||
            clipReferences.has(normalizeAgentReferenceText(track.name)) ||
            track.devices.some(
                (device) =>
                    clipReferences.has(normalizeAgentReferenceText(device.id)) ||
                    clipReferences.has(normalizeAgentReferenceText(device.type))
            )
    );
}

function getTrackCandidates(
    capability: AgentReferenceCapability,
    context: ProjectContext
): CapabilityCandidate[] | null {
    if (getAgentReferenceCapabilityKind(capability) === 'track') {
        return context.tracks
            .filter((track) => isAgentReferenceCapabilityCandidate({ capability, context, id: track.id }))
            .map((track) => ({ id: track.id, name: track.name, ownerQualified: false }));
    }
    return null;
}

function getReferenceCandidates(input: ResolveAgentReferenceInput): CapabilityCandidate[] {
    const trackCandidates = getTrackCandidates(input.capability, input.context);
    if (trackCandidates) {
        return trackCandidates;
    }

    if (getAgentReferenceCapabilityKind(input.capability) === 'clip') {
        let tracks = input.context.tracks;
        if (!hasExplicitClipSelection(input.prompt)) {
            const ownerReference = resolveTrackOwnerReference(input.prompt, input.context);
            if (ownerReference.status === 'ambiguous') {
                return [];
            }
            if (ownerReference.status === 'unique') {
                tracks = tracks.filter((track) => track.id === ownerReference.id);
            }
        }
        return tracks.flatMap((track) => {
            const ownerQualified = namesTrackAsQualifiedOwner(input.prompt, track);
            return track.clips.map((clip) => ({ id: clip.id, name: clip.name, ownerQualified }));
        });
    }

    if (input.capability === 'device' || input.capability === 'sidechain-capable-device') {
        let tracks = input.context.tracks;
        if (input.dependencyId) {
            tracks = tracks.filter((track) => track.id === input.dependencyId);
        } else if (hasExplicitTrackSelection(input.prompt)) {
            if (input.context.selectedTrackId === null) {
                return [];
            }
            tracks = tracks.filter((track) => track.id === input.context.selectedTrackId);
        } else {
            const ownerReference = resolveTrackOwnerReference(input.prompt, input.context);
            if (ownerReference.status === 'ambiguous') {
                return [];
            }
            if (ownerReference.status === 'unique') {
                tracks = tracks.filter((track) => track.id === ownerReference.id);
            }
        }
        const canonicalNamesByType = new Map(
            (input.context.availableDeviceTypes ?? []).map((deviceType) => [deviceType.id, deviceType.name])
        );
        return tracks.flatMap((track) => {
            const ownerQualified = namesTrackAsQualifiedOwner(input.prompt, track);
            return track.devices.flatMap((device) =>
                isAgentReferenceCapabilityCandidate({
                    capability: input.capability,
                    context: input.context,
                    dependencyId: track.id,
                    id: device.id,
                })
                    ? [
                          {
                              id: device.id,
                              name: canonicalNamesByType.get(device.type) ?? device.type,
                              ownerQualified,
                          },
                      ]
                    : []
            );
        });
    }

    if (input.capability === 'device-parameter' && input.dependencyId) {
        const device = input.context.tracks
            .flatMap((track) => track.devices)
            .find((candidate) => candidate.id === input.dependencyId);
        return (device?.parameters ?? []).map((parameter) => ({
            id: parameter.id,
            name: parameter.name,
            ownerQualified: false,
        }));
    }

    if (input.capability === 'automation-lane') {
        let lanes = input.context.automationLanes ?? [];
        if (hasExplicitTrackSelection(input.prompt)) {
            if (input.context.selectedTrackId === null) {
                return [];
            }
            lanes = lanes.filter((lane) => lane.trackId === input.context.selectedTrackId);
        } else {
            const ownerReference = resolveTrackOwnerReference(input.prompt, input.context);
            if (ownerReference.status === 'ambiguous') {
                return [];
            }
            if (ownerReference.status === 'unique') {
                lanes = lanes.filter((lane) => lane.trackId === ownerReference.id);
            }
        }
        return lanes.map((lane) => {
            const owner = input.context.tracks.find((track) => track.id === lane.trackId);
            return {
                id: lane.id,
                name: lane.name,
                ownerQualified: owner !== undefined && namesTrackAsQualifiedOwner(input.prompt, owner),
            };
        });
    }

    if (input.capability === 'adjustment-layer') {
        return (input.context.adjustmentLayers ?? []).map((layer) => ({
            id: layer.id,
            name: layer.name,
            ownerQualified: false,
        }));
    }

    if (input.capability === 'vca-group') {
        return (input.context.vcaGroups ?? []).map((group) => ({
            id: group.id,
            name: group.name,
            ownerQualified: false,
        }));
    }

    return [];
}

function removeOverlappedExactNameEvidence(
    prompt: string,
    candidates: readonly CapabilityCandidate[],
    evidenceById: Map<string, AgentReferenceEvidence>
): void {
    for (const candidate of candidates) {
        if (evidenceById.get(candidate.id) !== 'exact-name') {
            continue;
        }
        const normalizedName = normalizeAgentReferenceText(candidate.name);
        const longerCandidates = candidates.filter((otherCandidate) => {
            if (otherCandidate.id === candidate.id || evidenceById.get(otherCandidate.id) !== 'exact-name') {
                return false;
            }
            const otherName = normalizeAgentReferenceText(otherCandidate.name);
            return otherName.length > normalizedName.length && ` ${otherName} `.includes(` ${normalizedName} `);
        });
        if (longerCandidates.length === 0) {
            continue;
        }
        const nameRanges = getExactNameOverlapRanges(prompt, candidate.name);
        if (nameRanges.length === 0) {
            continue;
        }
        const longerRanges = longerCandidates.flatMap((otherCandidate) => [
            ...getExactNameOverlapRanges(prompt, otherCandidate.name),
        ]);
        const everyNameOccurrenceIsInsideALongerName = nameRanges.every((nameRange) =>
            longerRanges.some((longerRange) => nameRange.start >= longerRange.start && nameRange.end <= longerRange.end)
        );
        if (everyNameOccurrenceIsInsideALongerName) {
            evidenceById.delete(candidate.id);
        }
    }
}

function removeExactNameEvidenceOverlappedByLiteralIds(
    prompt: string,
    candidates: readonly CapabilityCandidate[],
    evidenceById: Map<string, AgentReferenceEvidence>
): void {
    const overlapPrompt = foldReferenceMarks(prompt);
    const literalIdRanges = candidates.flatMap((candidate) =>
        evidenceById.get(candidate.id) === 'literal-id'
            ? [...getContiguousReferenceRanges(overlapPrompt, candidate.id)]
            : []
    );
    if (literalIdRanges.length === 0) {
        return;
    }
    for (const candidate of candidates) {
        if (evidenceById.get(candidate.id) !== 'exact-name') {
            continue;
        }
        const nameRanges = getExactNameOverlapRanges(prompt, candidate.name);
        if (nameRanges.length === 0) {
            continue;
        }
        const everyNameOccurrenceIsInsideALiteralId = nameRanges.every((nameRange) =>
            literalIdRanges.some(
                (literalIdRange) => nameRange.start >= literalIdRange.start && nameRange.end <= literalIdRange.end
            )
        );
        if (everyNameOccurrenceIsInsideALiteralId) {
            evidenceById.delete(candidate.id);
        }
    }
}

function isGatedRisk(risk: AppActionRisk | undefined): boolean {
    return risk === undefined || GATED_RISKS.has(risk);
}

function getReservedReferenceWords(capability: AgentReferenceCapability): ReadonlySet<string> {
    if (capability === 'vca-group') {
        return reservedVcaGroupReferenceWords;
    }
    if (getAgentReferenceCapabilityKind(capability) === 'clip') {
        return reservedClipReferenceWords;
    }
    return NO_RESERVED_REFERENCE_WORDS;
}

/**
 * Best approximate reading of each candidate name in the prompt, keyed by candidate id. Only names the
 * user could plausibly have mistyped take part, and a window that is a reserved word for the capability
 * is vocabulary rather than a name.
 */
function getFuzzyNameSimilarities(
    input: ResolveAgentReferenceInput,
    candidates: readonly CapabilityCandidate[]
): Map<string, number> {
    const promptTokens = normalizeAgentReferenceText(maskQuotedTextContents(input.prompt))
        .split(' ')
        .filter((token) => token.length > 0);
    const reservedWords = getReservedReferenceWords(input.capability);
    const similarities = new Map<string, number>();

    for (const candidate of candidates) {
        const name = normalizeAgentReferenceText(candidate.name);
        if (name.length < MIN_FUZZY_NAME_LENGTH) {
            continue;
        }
        const tokenCount = name.split(' ').length;
        let bestSimilarity = 0;
        for (let start = 0; start + tokenCount <= promptTokens.length; start += 1) {
            const window = promptTokens.slice(start, start + tokenCount).join(' ');
            if (reservedWords.has(window)) {
                continue;
            }
            const similarity = 1 - levenshteinDistance(name, window) / Math.max(name.length, window.length);
            bestSimilarity = Math.max(bestSimilarity, similarity);
        }
        if (bestSimilarity >= MIN_FUZZY_NAME_SIMILARITY) {
            similarities.set(candidate.id, bestSimilarity);
        }
    }
    return similarities;
}

function isTieredEvidence(evidence: AgentReferenceEvidence | undefined): evidence is TieredEvidence {
    return evidence !== undefined && evidence !== 'fuzzy-name';
}

function rankReferenceCandidate(
    candidate: CapabilityCandidate,
    tieredEvidence: AgentReferenceEvidence | undefined,
    isSelected: boolean,
    fuzzySimilarity: number | undefined
): ReferenceCandidate | null {
    const scored: { confidence: number; evidence: AgentReferenceEvidence }[] = [];
    if (isTieredEvidence(tieredEvidence)) {
        scored.push({ confidence: EVIDENCE_CONFIDENCE[tieredEvidence], evidence: tieredEvidence });
    }
    if (isSelected && tieredEvidence !== 'selection') {
        scored.push({ confidence: EVIDENCE_CONFIDENCE.selection, evidence: 'selection' });
    }
    // A qualified owner phrase narrows the candidate pool; it never admits a candidate on its own, and
    // it cannot lift an approximate reading, whose whole claim is that the name was read only roughly.
    if (candidate.ownerQualified && isTieredEvidence(tieredEvidence)) {
        scored.push({ confidence: EVIDENCE_CONFIDENCE['owner-qualified'], evidence: 'owner-qualified' });
    }
    if (fuzzySimilarity !== undefined) {
        scored.push({ confidence: fuzzySimilarity * FUZZY_NAME_CONFIDENCE_FACTOR, evidence: 'fuzzy-name' });
    }
    if (scored.length === 0) {
        return null;
    }

    scored.sort((left, right) => right.confidence - left.confidence);
    return {
        id: candidate.id,
        name: candidate.name,
        confidence: scored[0]!.confidence,
        evidence: scored.map((entry) => entry.evidence),
    };
}

function rankReferenceCandidates(
    candidates: readonly CapabilityCandidate[],
    evidenceById: ReadonlyMap<string, AgentReferenceEvidence>,
    selectedReferenceId: string | null | undefined,
    fuzzySimilarityById: ReadonlyMap<string, number>
): ReferenceCandidate[] {
    return candidates
        .flatMap((candidate) => {
            const ranked = rankReferenceCandidate(
                candidate,
                evidenceById.get(candidate.id),
                candidate.id === selectedReferenceId,
                fuzzySimilarityById.get(candidate.id)
            );
            if (ranked === null) {
                return [];
            }
            return [ranked];
        })
        .sort((left, right) => {
            if (left.confidence !== right.confidence) {
                return right.confidence - left.confidence;
            }
            return left.name.localeCompare(right.name);
        });
}

export function resolveAgentReference(input: ResolveAgentReferenceInput): ResolveAgentReferenceResult {
    const excludedIds = new Set(input.excludedIds ?? []);
    const trackCandidates = getTrackCandidates(input.capability, input.context);
    const hasTrackSelection = trackCandidates !== null && hasExplicitTrackSelection(input.prompt);
    const hasClipSelection =
        getAgentReferenceCapabilityKind(input.capability) === 'clip' && hasExplicitClipSelection(input.prompt);
    let selectedReferenceId: string | null | undefined;
    if (hasTrackSelection) {
        selectedReferenceId = input.context.selectedTrackId;
    } else if (hasClipSelection) {
        const selectedClipIds = getSelectedClipReferenceIds(input.context);
        selectedReferenceId = selectedClipIds.length === 1 ? selectedClipIds[0]! : null;
    }

    let candidates = getReferenceCandidates(input).filter((candidate) => !excludedIds.has(candidate.id));
    if (selectedReferenceId !== undefined) {
        if (selectedReferenceId === null) {
            candidates = [];
        } else {
            candidates = candidates.filter((candidate) => candidate.id === selectedReferenceId);
        }
    }
    const evidenceById = new Map<string, AgentReferenceEvidence>();

    for (const candidate of candidates) {
        if (
            input.capability === 'output' &&
            candidate.id === 'master' &&
            !containsQualifiedMasterOutputReference(input.prompt)
        ) {
            continue;
        }
        const hasUnqualifiedReservedVcaId =
            input.capability === 'vca-group' &&
            reservedVcaGroupReferenceWords.has(normalizeAgentReferenceText(candidate.id)) &&
            !containsQualifiedVcaGroupReference(input.prompt, candidate.id);
        if (getContiguousReferenceRanges(input.prompt, candidate.id).length > 0 && !hasUnqualifiedReservedVcaId) {
            evidenceById.set(candidate.id, 'literal-id');
            continue;
        }
        if (containsExactPhrase(input.prompt, candidate.name)) {
            if (
                input.capability === 'vca-group' &&
                reservedVcaGroupReferenceWords.has(normalizeAgentReferenceText(candidate.name)) &&
                !containsQualifiedVcaGroupReference(input.prompt, candidate.name)
            ) {
                continue;
            }
            evidenceById.set(candidate.id, 'exact-name');
        }
    }

    if (selectedReferenceId !== null && selectedReferenceId !== undefined) {
        const selected = candidates.find((candidate) => candidate.id === selectedReferenceId);
        if (selected && !evidenceById.has(selected.id)) {
            evidenceById.set(selected.id, 'selection');
        }
    }

    if (
        input.capability === 'automation-lane' &&
        [...evidenceById.values()].some((evidence) => evidence === 'literal-id')
    ) {
        for (const [candidateId, evidence] of evidenceById) {
            if (evidence !== 'literal-id') {
                evidenceById.delete(candidateId);
            }
        }
    }

    removeExactNameEvidenceOverlappedByLiteralIds(input.prompt, candidates, evidenceById);
    removeOverlappedExactNameEvidence(input.prompt, candidates, evidenceById);

    const gated = isGatedRisk(input.risk);
    // Every tiered evidence already clears MIN_BINDING_CONFIDENCE, so approximate names are read only
    // once none of them admitted a candidate.
    let fuzzySimilarityById: ReadonlyMap<string, number> = new Map<string, number>();
    if (evidenceById.size === 0) {
        fuzzySimilarityById = getFuzzyNameSimilarities(input, candidates);
        const fuzzyCandidates = rankReferenceCandidates(
            candidates,
            evidenceById,
            selectedReferenceId,
            fuzzySimilarityById
        );
        if (fuzzyCandidates.length === 0) {
            return { status: 'rejected', reason: 'ungrounded-target', candidates: [] };
        }
        // Two approximate readings cannot be told apart by asking which of them the request meant, so
        // they are all weak rather than ambiguous: `ambiguous-target` stays for tiered evidence, where
        // the prompt did name something exactly and only the object it names is in doubt.
        if (fuzzyCandidates.length > 1) {
            return {
                status: 'rejected',
                reason: 'low-confidence-target',
                candidates: fuzzyCandidates,
                requirement: 'clarification',
            };
        }
        const bestFuzzyCandidate = fuzzyCandidates[0]!;
        if (gated && bestFuzzyCandidate.confidence < MIN_BINDING_CONFIDENCE) {
            return {
                status: 'rejected',
                reason: 'low-confidence-target',
                candidates: fuzzyCandidates,
                requirement: 'explicit-preview',
            };
        }
        evidenceById.set(bestFuzzyCandidate.id, 'fuzzy-name');
    }

    const rankedCandidates = rankReferenceCandidates(
        candidates,
        evidenceById,
        selectedReferenceId,
        fuzzySimilarityById
    );
    if (evidenceById.size > 1) {
        return {
            status: 'rejected',
            reason: 'ambiguous-target',
            candidateIds: [...evidenceById.keys()],
            candidates: rankedCandidates,
            requirement: gated ? 'clarification' : undefined,
        };
    }
    if (typeof input.assertedId !== 'string' || !evidenceById.has(input.assertedId)) {
        return { status: 'rejected', reason: 'asserted-target-mismatch', candidates: rankedCandidates };
    }
    if (input.capability === 'removable-track') {
        const track = input.context.tracks.find((candidate) => candidate.id === input.assertedId);
        if (!track || track.kind === 'master') {
            return { status: 'rejected', reason: 'ungrounded-target', candidates: rankedCandidates };
        }
    }
    if (getAgentReferenceCapabilityKind(input.capability) === 'clip') {
        const owningTrack = input.context.tracks.find((track) =>
            track.clips.some((clip) => clip.id === input.assertedId)
        );
        const clip = owningTrack?.clips.find((candidate) => candidate.id === input.assertedId);
        const requiresEditableClip =
            input.capability === 'editable-clip' ||
            input.capability === 'editable-audio-clip' ||
            input.capability === 'editable-midi-clip' ||
            input.capability === 'writable-midi-clip';
        const hasEligibleAudioContent = input.capability !== 'editable-audio-clip' || clip?.type === 'audio';
        const hasEligibleMidiContent =
            input.capability !== 'editable-midi-clip' || (clip?.type === 'midi' && clip.noteCount > 0);
        const hasWritableMidiTarget =
            input.capability !== 'writable-midi-clip' ||
            (clip?.type === 'midi' && owningTrack !== undefined && owningTrack.frozen !== true);
        if (
            !clip ||
            (requiresEditableClip && clip.locked === true) ||
            !hasEligibleAudioContent ||
            !hasEligibleMidiContent ||
            !hasWritableMidiTarget
        ) {
            return { status: 'rejected', reason: 'ungrounded-target', candidates: rankedCandidates };
        }
        const ownerReference = resolveTrackOwnerReference(input.prompt, input.context);
        const hasQualifiedClipReference = [clip.id, clip.name].some((reference) =>
            containsQualifiedClipReference(input.prompt, reference)
        );
        const hasSafeLiteralId =
            evidenceById.get(input.assertedId) === 'literal-id' &&
            !reservedClipReferenceWords.has(normalizeAgentReferenceText(clip.id));
        const requiresQualification =
            hasNonClipReferenceCollision(clip, input.context) ||
            reservedClipReferenceWords.has(normalizeAgentReferenceText(clip.id)) ||
            reservedClipReferenceWords.has(normalizeAgentReferenceText(clip.name));
        if (
            requiresQualification &&
            !hasSafeLiteralId &&
            !hasExplicitClipSelection(input.prompt) &&
            !hasQualifiedClipReference &&
            ownerReference.status !== 'unique'
        ) {
            return { status: 'rejected', reason: 'ungrounded-target', candidates: rankedCandidates };
        }
    }

    const bound = rankedCandidates.find((candidate) => candidate.id === input.assertedId);
    if (!bound) {
        return { status: 'rejected', reason: 'asserted-target-mismatch', candidates: rankedCandidates };
    }

    return {
        status: 'resolved',
        id: input.assertedId,
        evidence: bound.evidence[0]!,
        confidence: bound.confidence,
        candidates: rankedCandidates,
    };
}
