import { type ProjectContext } from '../../models/ProjectContext';

type AgentReferenceCapability =
    'track' | 'duplicable-track' | 'routable-source' | 'bus' | 'output' | 'device' | 'device-parameter';

type ResolveAgentReferenceInput = {
    prompt: string;
    assertedId: unknown;
    capability: AgentReferenceCapability;
    context: ProjectContext;
    dependencyId?: string;
    excludedIds?: readonly string[];
};

type ReferenceCandidate = {
    id: string;
    name: string;
};

type AgentReferenceEvidence = 'literal-id' | 'exact-name' | 'selection';

type ResolveAgentReferenceResult =
    | { status: 'resolved'; id: string; evidence: AgentReferenceEvidence }
    | {
          status: 'rejected';
          reason: 'ungrounded-target' | 'ambiguous-target' | 'asserted-target-mismatch';
          candidateIds?: string[];
      };

const duplicableTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus', 'folder']);
const routableTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus']);

function normalizeReferenceText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function containsExactPhrase(prompt: string, reference: string): boolean {
    const normalizedReference = normalizeReferenceText(reference);
    if (normalizedReference.length === 0) {
        return false;
    }
    return ` ${normalizeReferenceText(prompt)} `.includes(` ${normalizedReference} `);
}

function containsQualifiedMasterOutputReference(prompt: string): boolean {
    const normalized = normalizeReferenceText(prompt);
    return /\b(?:to|into|through) (?:the )?master\b|\bmaster (?:bus|channel|output)\b/u.test(normalized);
}

function hasExplicitTrackSelection(prompt: string): boolean {
    const normalized = normalizeReferenceText(prompt);
    return /\b(?:selected|current|this) (?:audio |midi |bus |folder )?track\b/u.test(normalized);
}

function getUniquelyReferencedTrackId(prompt: string, context: ProjectContext): string | null {
    const referencedTracks = context.tracks.filter(
        (track) => containsExactPhrase(prompt, track.id) || containsExactPhrase(prompt, track.name)
    );
    if (referencedTracks.length !== 1) {
        return null;
    }
    return referencedTracks[0]?.id ?? null;
}

function getTrackCandidates(
    capability: AgentReferenceCapability,
    context: ProjectContext
): ReferenceCandidate[] | null {
    if (capability === 'track') {
        return context.tracks;
    }
    if (capability === 'duplicable-track') {
        return context.tracks.filter((track) => duplicableTrackKinds.has(track.kind));
    }
    if (capability === 'routable-source') {
        return context.tracks.filter((track) => routableTrackKinds.has(track.kind));
    }
    if (capability === 'bus') {
        return context.tracks.filter((track) => track.kind === 'bus');
    }
    if (capability === 'output') {
        return context.tracks.filter((track) => track.kind === 'bus' || track.kind === 'master');
    }
    return null;
}

function getReferenceCandidates(input: ResolveAgentReferenceInput): ReferenceCandidate[] {
    const trackCandidates = getTrackCandidates(input.capability, input.context);
    if (trackCandidates) {
        return trackCandidates;
    }

    if (input.capability === 'device') {
        let tracks = input.context.tracks;
        if (hasExplicitTrackSelection(input.prompt)) {
            if (input.context.selectedTrackId === null) {
                return [];
            }
            tracks = tracks.filter((track) => track.id === input.context.selectedTrackId);
        } else {
            const ownerTrackId = getUniquelyReferencedTrackId(input.prompt, input.context);
            if (ownerTrackId !== null) {
                tracks = tracks.filter((track) => track.id === ownerTrackId);
            }
        }
        return tracks.flatMap((track) => track.devices.map((device) => ({ id: device.id, name: device.type })));
    }

    if (input.capability === 'device-parameter' && input.dependencyId) {
        const device = input.context.tracks
            .flatMap((track) => track.devices)
            .find((candidate) => candidate.id === input.dependencyId);
        return (device?.parameters ?? []).map((parameter) => ({ id: parameter.id, name: parameter.name }));
    }

    return [];
}

function getAmbiguousExactNameIds(
    assertedId: string,
    candidates: readonly ReferenceCandidate[],
    evidenceById: ReadonlyMap<string, AgentReferenceEvidence>
): string[] {
    const assertedCandidate = candidates.find((candidate) => candidate.id === assertedId);
    if (!assertedCandidate) {
        return [];
    }
    const normalizedName = normalizeReferenceText(assertedCandidate.name);
    return candidates
        .filter(
            (candidate) => normalizeReferenceText(candidate.name) === normalizedName && evidenceById.has(candidate.id)
        )
        .map((candidate) => candidate.id);
}

export function resolveAgentReference(input: ResolveAgentReferenceInput): ResolveAgentReferenceResult {
    const excludedIds = new Set(input.excludedIds ?? []);
    const candidates = getReferenceCandidates(input).filter((candidate) => !excludedIds.has(candidate.id));
    const evidenceById = new Map<string, AgentReferenceEvidence>();

    for (const candidate of candidates) {
        if (
            input.capability === 'output' &&
            candidate.id === 'master' &&
            !containsQualifiedMasterOutputReference(input.prompt)
        ) {
            continue;
        }
        if (containsExactPhrase(input.prompt, candidate.id)) {
            evidenceById.set(candidate.id, 'literal-id');
            continue;
        }
        if (containsExactPhrase(input.prompt, candidate.name)) {
            evidenceById.set(candidate.id, 'exact-name');
        }
    }

    const trackCandidates = getTrackCandidates(input.capability, input.context);
    if (trackCandidates && hasExplicitTrackSelection(input.prompt) && input.context.selectedTrackId !== null) {
        const selected = trackCandidates.find(
            (candidate) => candidate.id === input.context.selectedTrackId && !excludedIds.has(candidate.id)
        );
        if (selected && !evidenceById.has(selected.id)) {
            evidenceById.set(selected.id, 'selection');
        }
    }

    if (evidenceById.size === 0) {
        return { status: 'rejected', reason: 'ungrounded-target' };
    }
    if (typeof input.assertedId !== 'string' || !evidenceById.has(input.assertedId)) {
        return { status: 'rejected', reason: 'asserted-target-mismatch' };
    }

    const evidence = evidenceById.get(input.assertedId) ?? 'exact-name';
    if (evidence === 'exact-name') {
        const ambiguousIds = getAmbiguousExactNameIds(input.assertedId, candidates, evidenceById);
        if (ambiguousIds.length > 1) {
            return { status: 'rejected', reason: 'ambiguous-target', candidateIds: ambiguousIds };
        }
    }

    return { status: 'resolved', id: input.assertedId, evidence };
}
