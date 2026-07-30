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

function hasExplicitTrackSelection(prompt: string): boolean {
    const normalized = normalizeReferenceText(prompt);
    return /\b(?:selected|current|this) (?:audio |midi |bus |folder )?track\b/u.test(normalized);
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
        if (hasExplicitTrackSelection(input.prompt) && input.context.selectedTrackId !== null) {
            tracks = tracks.filter((track) => track.id === input.context.selectedTrackId);
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

export function resolveAgentReference(input: ResolveAgentReferenceInput): ResolveAgentReferenceResult {
    const excludedIds = new Set(input.excludedIds ?? []);
    const candidates = getReferenceCandidates(input).filter((candidate) => !excludedIds.has(candidate.id));
    const evidenceById = new Map<string, AgentReferenceEvidence>();

    for (const candidate of candidates) {
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

    const candidateIds = [...evidenceById.keys()];
    if (candidateIds.length === 0) {
        return { status: 'rejected', reason: 'ungrounded-target' };
    }
    if (candidateIds.length > 1) {
        return { status: 'rejected', reason: 'ambiguous-target', candidateIds };
    }

    const id = candidateIds[0];
    if (typeof input.assertedId !== 'string' || input.assertedId !== id) {
        return { status: 'rejected', reason: 'asserted-target-mismatch' };
    }
    return { status: 'resolved', id, evidence: evidenceById.get(id) ?? 'exact-name' };
}
