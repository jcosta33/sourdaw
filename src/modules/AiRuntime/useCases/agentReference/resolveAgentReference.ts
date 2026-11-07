import { type getAppActionExecutionPolicy } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { maskQuotedTextContents } from '../../transformers/promptParser/promptQuotedText';
import { getSelectedClipReferenceIds } from '../../transformers/promptParser/selectedClipReference';

import { getAgentReferenceCapabilityKind } from './agentReferenceCapabilityKinds';
import { findAgentReferenceNameSpans, type AgentReferenceNameForms } from './findAgentReferenceNameSpans';
import { getAgentReferenceCandidates, type AgentReferenceCandidate } from './getAgentReferenceCandidates';
import { getBestAgentReferenceNameRanges } from './getBestAgentReferenceNameRanges';
import { LEVEL_DIRECTION_WORDS } from './groundingStrategies/classifyPromptDecibelFigures';
import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { parsePromptNumberValue } from './groundingStrategies/parsePromptNumberValue';
import { hasExplicitClipSelection } from './hasExplicitClipSelection';
import { hasExplicitTrackSelection } from './hasExplicitTrackSelection';
import { type AgentReferenceCapability } from './isAgentReferenceCapabilityCandidate';
import { levenshteinDistance } from './levenshteinDistance';
import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';
import { resolveTrackOwnerReference } from './resolveTrackOwnerReference';

type AppActionRisk = ReturnType<typeof getAppActionExecutionPolicy>['risk'];

export type ResolveAgentReferenceInput = {
    prompt: string;
    assertedId: unknown;
    capability: AgentReferenceCapability;
    context: ProjectContext;
    dependencyId?: string;
    excludedIds?: readonly string[];
    risk?: AppActionRisk;
    /**
     * Read what the prompt names by literal id or whole name, taking names in these forms, instead of
     * resolving a reference: no selection phrase narrows the candidates or stands as evidence.
     * Resolution reads the exact forms.
     */
    naming?: AgentReferenceNameForms;
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

/**
 * Tokens a clause states after its target rather than as the rest of its name: the direction and
 * qualifier words a level clause uses, the track control verbs, the nouns that qualify a master
 * output reference, and any numeric figure.
 */
const SENTENCE_MATERIAL_TOKENS: ReadonlySet<string> = new Set([
    ...LEVEL_DIRECTION_WORDS,
    'mute',
    'solo',
    'bus',
    'channel',
    'output',
]);

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

/** Every range of the prompt that states the id as typed: its words joined by hyphens or underscores, case aside. */
function getLiteralIdRanges(prompt: string, id: string): readonly { end: number; start: number }[] {
    const tokens = normalizeAgentReferenceText(id)
        .split(' ')
        .filter((token) => token.length > 0);
    if (tokens.length === 0) {
        return [];
    }
    const needle = tokens.map((token) => escapeRegExp(token)).join('[-_]+');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${needle}(?![\\p{L}\\p{N}])`, 'giu');
    return Array.from(prompt.matchAll(pattern), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
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

function containsQualifiedClipReference(prompt: string, reference: string): boolean {
    const normalizedPrompt = ` ${normalizeAgentReferenceText(prompt)} `;
    const normalizedReference = normalizeAgentReferenceText(reference);
    return (
        normalizedPrompt.includes(` ${normalizedReference} clip `) ||
        normalizedPrompt.includes(` clip ${normalizedReference} `)
    );
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

/**
 * A name stated only where another candidate's name reads that range better names nothing: "Drum"
 * inside "Drum Bus" states the bus, "Vocal" states Vocal and not Vocals.
 */
function removeOutreadExactNameEvidence(
    prompt: string,
    candidates: readonly AgentReferenceCandidate[],
    evidenceById: Map<string, AgentReferenceEvidence>,
    forms: AgentReferenceNameForms
): void {
    const named = candidates.filter((candidate) => evidenceById.get(candidate.id) === 'exact-name');
    const statedIds = new Set(getBestAgentReferenceNameRanges(prompt, named, forms).map((range) => range.id));
    for (const candidate of named) {
        if (!statedIds.has(candidate.id)) {
            evidenceById.delete(candidate.id);
        }
    }
}

function removeExactNameEvidenceOverlappedByLiteralIds(
    prompt: string,
    candidates: readonly AgentReferenceCandidate[],
    evidenceById: Map<string, AgentReferenceEvidence>,
    forms: AgentReferenceNameForms
): void {
    const literalIdRanges = candidates.flatMap((candidate) =>
        evidenceById.get(candidate.id) === 'literal-id' ? getLiteralIdRanges(prompt, candidate.id) : []
    );
    if (literalIdRanges.length === 0) {
        return;
    }
    const candidateNames = candidates.map((candidate) => candidate.name);
    for (const candidate of candidates) {
        if (evidenceById.get(candidate.id) !== 'exact-name') {
            continue;
        }
        const nameRanges = findAgentReferenceNameSpans(prompt, candidate.name, forms, candidateNames);
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

/**
 * List punctuation starts another list item — a comma, a semicolon, or a dash set off by spaces —
 * while name punctuation continues one name ("Master-Take", "Master's Choir", "Master/Take").
 */
function joinerCarriesListPunctuation(joiner: string): boolean {
    return /[,;]|\s[-–—]|[-–—]\s/u.test(joiner);
}

/**
 * Whether one exact-name match reads the given id occurrence as part of the name being typed. A match
 * that reaches past the id word through list punctuation ("master, drums") or ends on sentence
 * material — a level figure, a direction, a control verb, or a master-qualifier noun — is the
 * instruction continuing after the target, not the rest of its name. Name punctuation continues the
 * name itself, so it consumes the occurrence.
 */
function nameMatchConsumesIdOccurrence(
    prompt: string,
    idRange: { end: number; start: number },
    nameRange: { end: number; start: number }
): boolean {
    const tail = prompt.slice(idRange.end, nameRange.end);
    const joinerAfterId = /^[^\p{L}\p{N}]+/u.exec(tail)?.[0];
    if (joinerAfterId !== undefined && joinerCarriesListPunctuation(joinerAfterId)) {
        return false;
    }
    const matchedName = prompt.slice(nameRange.start, nameRange.end);
    const trailingToken = normalizeAgentReferenceText(matchedName).split(' ').at(-1) ?? '';
    return !SENTENCE_MATERIAL_TOKENS.has(trailingToken) && parsePromptNumberValue(trailingToken) === null;
}

/**
 * A literal id read from a word that every occurrence sits inside a longer exact-name match was the
 * name being typed, not the id ("Master" inside "Master Take"), so it yields to the name. A match that
 * only reached past the id word on sentence material ("turn the master down 2 dB" beside a "Master
 * Down" track) is not the name being typed, so the id stands and the prompt stays ambiguous. A span
 * that only equals the id's own text stays ambiguous too: that prompt names both objects equally.
 */
function removeLiteralIdEvidenceNestedInExactNames(
    prompt: string,
    candidates: readonly AgentReferenceCandidate[],
    evidenceById: Map<string, AgentReferenceEvidence>,
    forms: AgentReferenceNameForms
): void {
    const candidateNames = candidates.map((candidate) => candidate.name);
    const exactNameRanges = candidates.flatMap((candidate) =>
        evidenceById.get(candidate.id) === 'exact-name'
            ? findAgentReferenceNameSpans(prompt, candidate.name, forms, candidateNames)
            : []
    );
    if (exactNameRanges.length === 0) {
        return;
    }
    for (const candidate of candidates) {
        if (evidenceById.get(candidate.id) !== 'literal-id') {
            continue;
        }
        const idRanges = getLiteralIdRanges(prompt, candidate.id);
        if (idRanges.length === 0) {
            continue;
        }
        const everyIdOccurrenceIsInsideALongerExactName = idRanges.every((idRange) =>
            exactNameRanges.some(
                (nameRange) =>
                    nameRange.start <= idRange.start &&
                    idRange.end <= nameRange.end &&
                    (nameRange.start < idRange.start || idRange.end < nameRange.end) &&
                    nameMatchConsumesIdOccurrence(prompt, idRange, nameRange)
            )
        );
        if (everyIdOccurrenceIsInsideALongerExactName) {
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
    candidates: readonly AgentReferenceCandidate[]
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
    candidate: AgentReferenceCandidate,
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
    candidates: readonly AgentReferenceCandidate[],
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

/**
 * The candidates the prompt names by literal id or whole name, each range of the prompt naming only
 * the candidates whose names read it best.
 */
function readNameEvidence(
    prompt: string,
    capability: AgentReferenceCapability,
    candidates: readonly AgentReferenceCandidate[],
    forms: AgentReferenceNameForms
): Map<string, AgentReferenceEvidence> {
    const evidenceById = new Map<string, AgentReferenceEvidence>();
    const candidateNames = candidates.map((candidate) => candidate.name);
    for (const candidate of candidates) {
        if (capability === 'output' && candidate.id === 'master' && !containsQualifiedMasterOutputReference(prompt)) {
            continue;
        }
        const hasUnqualifiedReservedVcaId =
            capability === 'vca-group' &&
            reservedVcaGroupReferenceWords.has(normalizeAgentReferenceText(candidate.id)) &&
            !containsQualifiedVcaGroupReference(prompt, candidate.id);
        if (getLiteralIdRanges(prompt, candidate.id).length > 0 && !hasUnqualifiedReservedVcaId) {
            evidenceById.set(candidate.id, 'literal-id');
            continue;
        }
        if (findAgentReferenceNameSpans(prompt, candidate.name, forms, candidateNames).length > 0) {
            if (
                capability === 'vca-group' &&
                reservedVcaGroupReferenceWords.has(normalizeAgentReferenceText(candidate.name)) &&
                !containsQualifiedVcaGroupReference(prompt, candidate.name)
            ) {
                continue;
            }
            evidenceById.set(candidate.id, 'exact-name');
        }
    }

    if (capability === 'automation-lane' && [...evidenceById.values()].some((evidence) => evidence === 'literal-id')) {
        for (const [candidateId, evidence] of evidenceById) {
            if (evidence !== 'literal-id') {
                evidenceById.delete(candidateId);
            }
        }
    }

    removeExactNameEvidenceOverlappedByLiteralIds(prompt, candidates, evidenceById, forms);
    removeOutreadExactNameEvidence(prompt, candidates, evidenceById, forms);
    removeLiteralIdEvidenceNestedInExactNames(prompt, candidates, evidenceById, forms);
    return evidenceById;
}

export function resolveAgentReference(input: ResolveAgentReferenceInput): ResolveAgentReferenceResult {
    const excludedIds = new Set(input.excludedIds ?? []);
    const readsSelection = input.naming === undefined;
    const hasTrackSelection =
        readsSelection &&
        getAgentReferenceCapabilityKind(input.capability) === 'track' &&
        hasExplicitTrackSelection(input.prompt);
    const hasClipSelection =
        readsSelection &&
        getAgentReferenceCapabilityKind(input.capability) === 'clip' &&
        hasExplicitClipSelection(input.prompt);
    let selectedReferenceId: string | null | undefined;
    if (hasTrackSelection) {
        selectedReferenceId = input.context.selectedTrackId;
    } else if (hasClipSelection) {
        const selectedClipIds = getSelectedClipReferenceIds(input.context);
        selectedReferenceId = selectedClipIds.length === 1 ? selectedClipIds[0]! : null;
    }

    let candidates = getAgentReferenceCandidates(input).filter((candidate) => !excludedIds.has(candidate.id));
    if (selectedReferenceId !== undefined) {
        if (selectedReferenceId === null) {
            candidates = [];
        } else {
            candidates = candidates.filter((candidate) => candidate.id === selectedReferenceId);
        }
    }
    const evidenceById = readNameEvidence(input.prompt, input.capability, candidates, input.naming ?? 'exact');
    if (selectedReferenceId !== null && selectedReferenceId !== undefined) {
        const selected = candidates.find((candidate) => candidate.id === selectedReferenceId);
        if (selected && !evidenceById.has(selected.id)) {
            evidenceById.set(selected.id, 'selection');
        }
    }

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
