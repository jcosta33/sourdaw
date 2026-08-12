import { type ProjectContext } from '../../models/ProjectContext';

type AgentReferenceCapability =
    | 'track'
    | 'armable-track'
    | 'duplicable-track'
    | 'removable-track'
    | 'routable-source'
    | 'bus'
    | 'output'
    | 'device-host-track'
    | 'device'
    | 'device-parameter'
    | 'vca-group'
    | 'vca-member-track'
    | 'automation-lane'
    | 'clip'
    | 'editable-clip'
    | 'editable-audio-clip'
    | 'editable-midi-clip';

type ResolveAgentReferenceInput = {
    prompt: string;
    assertedId: unknown;
    capability: AgentReferenceCapability;
    context: ProjectContext;
    dependencyId?: string;
    excludedIds?: readonly string[];
    effectRisk?:
        | 'bounded-reversible'
        | 'broad-reversible'
        | 'destructive-reversible'
        | 'authority-sensitive'
        | 'external-effect';
    mode?: 'execute' | 'preview';
};

type ReferenceCandidate = {
    id: string;
    name: string;
    track?: ProjectContext['tracks'][number];
};

type AgentReferenceEvidence =
    | 'literal-id'
    | 'exact-name'
    | 'selection'
    | 'role'
    | 'section'
    | 'tag'
    | 'recency'
    | 'fuzzy-name'
    | 'inferred-property';

type AgentReferenceEvidenceReceipt = {
    kind: AgentReferenceEvidence;
    value: string;
};

type ResolveAgentReferenceResult =
    | {
          status: 'resolved';
          id: string;
          evidence: AgentReferenceEvidence;
          confidence: number;
          evidenceReceipt: AgentReferenceEvidenceReceipt[];
      }
    | {
          status: 'rejected';
          reason:
              | 'ungrounded-target'
              | 'ambiguous-target'
              | 'asserted-target-mismatch'
              | 'clarification-required'
              | 'preview-required';
          candidateIds?: string[];
          candidates?: Array<{ id: string; confidence: number; evidence: AgentReferenceEvidenceReceipt[] }>;
      };

const confidenceByEvidence: Record<AgentReferenceEvidence, number> = {
    'literal-id': 1,
    'exact-name': 1,
    selection: 1,
    role: 0.95,
    section: 0.9,
    tag: 0.9,
    recency: 0.85,
    'fuzzy-name': 0.75,
    'inferred-property': 0.8,
};

const riskyEffectLevels = new Set([
    'broad-reversible',
    'destructive-reversible',
    'authority-sensitive',
    'external-effect',
]);

const duplicableTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus', 'folder']);
const routableTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus']);
const vcaMemberTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus', 'folder']);
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

function containsQualifiedVcaGroupReference(prompt: string, reference: string): boolean {
    const normalizedPrompt = ` ${normalizeReferenceText(prompt)} `;
    const normalizedReference = normalizeReferenceText(reference);
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
    const normalized = normalizeReferenceText(prompt);
    return /\b(?:selected|current|this) (?:audio |midi |bus |folder )?track\b/u.test(normalized);
}

function hasExplicitClipSelection(prompt: string): boolean {
    const normalized = normalizeReferenceText(prompt);
    return /\b(?:selected|current|this) (?:audio |midi )?clip\b/u.test(normalized);
}

function containsQualifiedClipReference(prompt: string, reference: string): boolean {
    const normalizedPrompt = ` ${normalizeReferenceText(prompt)} `;
    const normalizedReference = normalizeReferenceText(reference);
    return (
        normalizedPrompt.includes(` ${normalizedReference} clip `) ||
        normalizedPrompt.includes(` clip ${normalizedReference} `)
    );
}

function isClipCapability(capability: AgentReferenceCapability): boolean {
    return (
        capability === 'clip' ||
        capability === 'editable-clip' ||
        capability === 'editable-audio-clip' ||
        capability === 'editable-midi-clip'
    );
}

type TrackOwnerReference = { status: 'none' } | { status: 'unique'; id: string } | { status: 'ambiguous' };

function containsQualifiedTrackOwnerReference(prompt: string, reference: string): boolean {
    const normalizedPrompt = ` ${normalizeReferenceText(prompt)} `;
    const normalizedReference = normalizeReferenceText(reference);
    return [
        ` on ${normalizedReference} `,
        ` on the ${normalizedReference} `,
        ` in ${normalizedReference} `,
        ` in the ${normalizedReference} `,
        ` from ${normalizedReference} `,
        ` from the ${normalizedReference} `,
    ].some((qualifiedReference) => normalizedPrompt.includes(qualifiedReference));
}

function resolveTrackOwnerReference(prompt: string, context: ProjectContext): TrackOwnerReference {
    const referencedTracks = context.tracks.filter(
        (track) =>
            containsQualifiedTrackOwnerReference(prompt, track.id) ||
            containsQualifiedTrackOwnerReference(prompt, track.name)
    );
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
    const clipReferences = new Set([normalizeReferenceText(clip.id), normalizeReferenceText(clip.name)]);
    return context.tracks.some(
        (track) =>
            clipReferences.has(normalizeReferenceText(track.id)) ||
            clipReferences.has(normalizeReferenceText(track.name)) ||
            track.devices.some(
                (device) =>
                    clipReferences.has(normalizeReferenceText(device.id)) ||
                    clipReferences.has(normalizeReferenceText(device.type))
            )
    );
}

function getTrackCandidates(
    capability: AgentReferenceCapability,
    context: ProjectContext
): ReferenceCandidate[] | null {
    if (capability === 'track') {
        return context.tracks.map((track) => ({ id: track.id, name: track.name, track }));
    }
    if (capability === 'armable-track') {
        return context.tracks
            .filter((track) => track.kind !== 'vca')
            .map((track) => ({ id: track.id, name: track.name, track }));
    }
    if (capability === 'duplicable-track') {
        return context.tracks
            .filter((track) => duplicableTrackKinds.has(track.kind))
            .map((track) => ({ id: track.id, name: track.name, track }));
    }
    if (capability === 'removable-track') {
        return context.tracks.map((track) => ({ id: track.id, name: track.name, track }));
    }
    if (capability === 'routable-source') {
        return context.tracks
            .filter((track) => routableTrackKinds.has(track.kind))
            .map((track) => ({ id: track.id, name: track.name, track }));
    }
    if (capability === 'bus') {
        return context.tracks
            .filter((track) => track.kind === 'bus')
            .map((track) => ({ id: track.id, name: track.name, track }));
    }
    if (capability === 'output') {
        return context.tracks
            .filter((track) => track.kind === 'bus' || track.kind === 'master')
            .map((track) => ({ id: track.id, name: track.name, track }));
    }
    if (capability === 'device-host-track') {
        return context.tracks
            .filter((track) => track.kind !== 'vca')
            .map((track) => ({ id: track.id, name: track.name, track }));
    }
    if (capability === 'vca-member-track') {
        return context.tracks
            .filter((track) => vcaMemberTrackKinds.has(track.kind))
            .map((track) => ({ id: track.id, name: track.name, track }));
    }
    return null;
}

function getReferenceCandidates(input: ResolveAgentReferenceInput): ReferenceCandidate[] {
    const trackCandidates = getTrackCandidates(input.capability, input.context);
    if (trackCandidates) {
        return trackCandidates;
    }

    if (isClipCapability(input.capability)) {
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
        const clips = tracks.flatMap((track) => track.clips);
        return clips.map((clip) => ({ id: clip.id, name: clip.name }));
    }

    if (input.capability === 'device') {
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
        return tracks.flatMap((track) =>
            track.devices.map((device) => ({
                id: device.id,
                name: canonicalNamesByType.get(device.type) ?? device.type,
            }))
        );
    }

    if (input.capability === 'device-parameter' && input.dependencyId) {
        const device = input.context.tracks
            .flatMap((track) => track.devices)
            .find((candidate) => candidate.id === input.dependencyId);
        return (device?.parameters ?? []).map((parameter) => ({ id: parameter.id, name: parameter.name }));
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
        return lanes.map((lane) => ({ id: lane.id, name: lane.name }));
    }

    if (input.capability === 'vca-group') {
        return (input.context.vcaGroups ?? []).map((group) => ({ id: group.id, name: group.name }));
    }

    return [];
}

function removeOverlappedExactNameEvidence(
    candidates: readonly ReferenceCandidate[],
    evidenceById: Map<string, AgentReferenceEvidence>
): void {
    for (const candidate of candidates) {
        if (evidenceById.get(candidate.id) !== 'exact-name') {
            continue;
        }
        const normalizedName = normalizeReferenceText(candidate.name);
        const isContainedByLongerName = candidates.some((otherCandidate) => {
            if (otherCandidate.id === candidate.id || evidenceById.get(otherCandidate.id) !== 'exact-name') {
                return false;
            }
            const otherName = normalizeReferenceText(otherCandidate.name);
            return otherName.length > normalizedName.length && ` ${otherName} `.includes(` ${normalizedName} `);
        });
        if (isContainedByLongerName) {
            evidenceById.delete(candidate.id);
        }
    }
}

function fuzzyNameConfidence(prompt: string, name: string): number {
    const normalizedPrompt = normalizeReferenceText(prompt);
    const normalizedName = normalizeReferenceText(name);
    if (normalizedName.length < 3) {
        return 0;
    }
    const words = normalizedPrompt.split(' ');
    const nameWordCount = normalizedName.split(' ').length;
    if (words.length < nameWordCount) {
        return (
            1 -
            editDistance(normalizedPrompt, normalizedName) / Math.max(normalizedPrompt.length, normalizedName.length)
        );
    }
    let best = 0;
    for (let index = 0; index <= words.length - nameWordCount; index++) {
        const phrase = words.slice(index, index + nameWordCount).join(' ');
        if (phrase.length < 3) {
            continue;
        }
        const distance = editDistance(phrase, normalizedName);
        best = Math.max(best, 1 - distance / Math.max(phrase.length, normalizedName.length));
    }
    return best;
}

function editDistance(left: string, right: string): number {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const substitution = previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
            current[rightIndex] = Math.min(previous[rightIndex]! + 1, current[rightIndex - 1]! + 1, substitution);
        }
        previous.splice(0, previous.length, ...current);
    }
    return previous[right.length] ?? 0;
}

function containsSectionReference(
    prompt: string,
    track: ProjectContext['tracks'][number],
    context: ProjectContext
): string | null {
    const section = (context.sections ?? []).find((candidate) => containsExactPhrase(prompt, candidate.name));
    if (!section) {
        return null;
    }
    const overlaps = track.clips.some((clip) => clip.startBeat < section.endBeat && clip.endBeat > section.startBeat);
    return overlaps ? section.name : null;
}

function getTrackRoleEvidence(prompt: string, trackId: string, context: ProjectContext): string | null {
    const roles = context.productionBrief?.trackRoles.filter((role) => role.trackId === trackId) ?? [];
    return roles.find((role) => containsExactPhrase(prompt, role.role))?.role ?? null;
}

function getTrackTagEvidence(prompt: string, track: ProjectContext['tracks'][number]): string | null {
    const tags = [track.kind, track.muted ? 'muted' : null, track.soloed ? 'soloed' : null].filter(
        (value): value is string => value !== null
    );
    return tags.find((tag) => containsExactPhrase(prompt, tag)) ?? null;
}

function getMostRecentTrackIds(context: ProjectContext, candidateIds: readonly string[]): string[] {
    const eligibleIds = new Set(candidateIds);
    const history = (context.agentReferenceHistory ?? []).filter((entry) => eligibleIds.has(entry.id));
    if (history.length === 0) {
        return [];
    }
    const latestTimestamp = Math.max(...history.map((entry) => entry.referencedAt));
    return [...new Set(history.filter((entry) => entry.referencedAt === latestTimestamp).map((entry) => entry.id))];
}

function getInferredPropertyCandidateIds(prompt: string, candidates: readonly ReferenceCandidate[]): string[] {
    const normalized = normalizeReferenceText(prompt);
    const tracks = candidates.filter((candidate) => candidate.track !== undefined);
    function extrema(read: (track: ProjectContext['tracks'][number]) => number, highest: boolean): string[] {
        if (tracks.length === 0) {
            return [];
        }
        const values = tracks.map((candidate) => read(candidate.track!));
        const target = highest ? Math.max(...values) : Math.min(...values);
        return tracks.filter((candidate) => read(candidate.track!) === target).map((candidate) => candidate.id);
    }
    if (/\b(?:loudest|highest volume|highest gain) track\b/u.test(normalized)) {
        return extrema((track) => track.gain, true);
    }
    if (/\b(?:quietest|lowest volume|lowest gain) track\b/u.test(normalized)) {
        return extrema((track) => track.gain, false);
    }
    if (/\btrack with (?:the )?most clips\b/u.test(normalized)) {
        return extrema((track) => track.clipCount, true);
    }
    if (/\btrack with (?:the )?most devices\b/u.test(normalized)) {
        return extrema((track) => track.deviceCount, true);
    }
    return [];
}

function getEvidenceValue(
    evidence: AgentReferenceEvidence,
    candidate: ReferenceCandidate,
    prompt: string,
    context: ProjectContext,
    candidates: readonly ReferenceCandidate[]
): string {
    if (evidence === 'literal-id' || evidence === 'selection') {
        return candidate.id;
    }
    if (evidence === 'exact-name' || evidence === 'fuzzy-name') {
        return candidate.name;
    }
    if (evidence === 'role') {
        return getTrackRoleEvidence(prompt, candidate.id, context) ?? candidate.id;
    }
    if (evidence === 'section' && candidate.track) {
        return containsSectionReference(prompt, candidate.track, context) ?? candidate.id;
    }
    if (evidence === 'tag' && candidate.track) {
        return getTrackTagEvidence(prompt, candidate.track) ?? candidate.id;
    }
    if (evidence === 'recency') {
        const reference = (context.agentReferenceHistory ?? [])
            .filter((entry) => entry.id === candidate.id)
            .toSorted((left, right) => right.referencedAt - left.referencedAt)[0];
        return reference ? `referencedAt=${String(reference.referencedAt)}` : candidate.id;
    }
    if (evidence === 'inferred-property' && candidate.track) {
        const normalized = normalizeReferenceText(prompt);
        const eligibleTrackCount = candidates.filter((item) => item.track !== undefined).length;
        if (/\b(?:loudest|highest volume|highest gain) track\b/u.test(normalized)) {
            return `gain=${String(candidate.track.gain)}; maximum among ${String(eligibleTrackCount)} eligible tracks`;
        }
        if (/\b(?:quietest|lowest volume|lowest gain) track\b/u.test(normalized)) {
            return `gain=${String(candidate.track.gain)}; minimum among ${String(eligibleTrackCount)} eligible tracks`;
        }
        if (/\btrack with (?:the )?most clips\b/u.test(normalized)) {
            return `clipCount=${String(candidate.track.clipCount)}; maximum among ${String(eligibleTrackCount)} eligible tracks`;
        }
        if (/\btrack with (?:the )?most devices\b/u.test(normalized)) {
            return `deviceCount=${String(candidate.track.deviceCount)}; maximum among ${String(eligibleTrackCount)} eligible tracks`;
        }
    }
    return candidate.id;
}

export function resolveAgentReference(input: ResolveAgentReferenceInput): ResolveAgentReferenceResult {
    const excludedIds = new Set(input.excludedIds ?? []);
    const trackCandidates = getTrackCandidates(input.capability, input.context);
    const hasTrackSelection = trackCandidates !== null && hasExplicitTrackSelection(input.prompt);
    const hasClipSelection = isClipCapability(input.capability) && hasExplicitClipSelection(input.prompt);
    let selectedReferenceId: string | null | undefined;
    if (hasTrackSelection) {
        selectedReferenceId = input.context.selectedTrackId;
    } else if (hasClipSelection) {
        const selectedClipIds = new Set(input.context.selectedClipIds);
        if (input.context.selectedClipId !== null) {
            selectedClipIds.add(input.context.selectedClipId);
        }
        selectedReferenceId = selectedClipIds.size === 1 ? [...selectedClipIds][0]! : null;
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
            reservedVcaGroupReferenceWords.has(normalizeReferenceText(candidate.id)) &&
            !containsQualifiedVcaGroupReference(input.prompt, candidate.id);
        if (containsExactPhrase(input.prompt, candidate.id) && !hasUnqualifiedReservedVcaId) {
            evidenceById.set(candidate.id, 'literal-id');
            continue;
        }
        if (containsExactPhrase(input.prompt, candidate.name)) {
            if (
                input.capability === 'vca-group' &&
                reservedVcaGroupReferenceWords.has(normalizeReferenceText(candidate.name)) &&
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

    const trackReferenceCandidates = candidates.filter((candidate) => candidate.track !== undefined);
    if (trackReferenceCandidates.length > 0) {
        let mostRecentTrackIds = new Set<string>();
        if (/\b(?:most recently referenced|most recent) track\b/u.test(normalizeReferenceText(input.prompt))) {
            mostRecentTrackIds = new Set(
                getMostRecentTrackIds(
                    input.context,
                    trackReferenceCandidates.map((candidate) => candidate.id)
                )
            );
        }
        const inferredPropertyIds = new Set(getInferredPropertyCandidateIds(input.prompt, trackReferenceCandidates));
        for (const candidate of trackReferenceCandidates) {
            if (evidenceById.has(candidate.id)) {
                continue;
            }
            if (getTrackRoleEvidence(input.prompt, candidate.id, input.context) !== null) {
                evidenceById.set(candidate.id, 'role');
                continue;
            }
            if (candidate.track && containsSectionReference(input.prompt, candidate.track, input.context) !== null) {
                evidenceById.set(candidate.id, 'section');
                continue;
            }
            if (candidate.track && getTrackTagEvidence(input.prompt, candidate.track) !== null) {
                evidenceById.set(candidate.id, 'tag');
                continue;
            }
            if (mostRecentTrackIds.has(candidate.id)) {
                evidenceById.set(candidate.id, 'recency');
                continue;
            }
            if (inferredPropertyIds.has(candidate.id)) {
                evidenceById.set(candidate.id, 'inferred-property');
                continue;
            }
        }
    }

    for (const candidate of candidates) {
        if (!evidenceById.has(candidate.id) && fuzzyNameConfidence(input.prompt, candidate.name) >= 0.7) {
            evidenceById.set(candidate.id, 'fuzzy-name');
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

    removeOverlappedExactNameEvidence(candidates, evidenceById);

    const candidateReceipts = [...evidenceById].map(([id, evidence]) => {
        const candidate = candidates.find((item) => item.id === id)!;
        return {
            id,
            confidence: confidenceByEvidence[evidence],
            evidence: [
                {
                    kind: evidence,
                    value: getEvidenceValue(evidence, candidate, input.prompt, input.context, candidates),
                },
            ],
        };
    });

    if (evidenceById.size === 0) {
        return { status: 'rejected', reason: 'ungrounded-target' };
    }
    if (evidenceById.size > 1) {
        const risky = input.effectRisk !== undefined && riskyEffectLevels.has(input.effectRisk);
        return {
            status: 'rejected',
            reason: risky ? 'clarification-required' : 'ambiguous-target',
            candidateIds: [...evidenceById.keys()],
            candidates: candidateReceipts,
        };
    }
    if (typeof input.assertedId !== 'string' || !evidenceById.has(input.assertedId)) {
        return { status: 'rejected', reason: 'asserted-target-mismatch' };
    }
    if (input.capability === 'removable-track') {
        const track = input.context.tracks.find((candidate) => candidate.id === input.assertedId);
        if (!track || track.kind === 'master') {
            return { status: 'rejected', reason: 'ungrounded-target' };
        }
    }
    if (isClipCapability(input.capability)) {
        const clip = input.context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === input.assertedId);
        const requiresEditableClip =
            input.capability === 'editable-clip' ||
            input.capability === 'editable-audio-clip' ||
            input.capability === 'editable-midi-clip';
        const hasEligibleAudioContent = input.capability !== 'editable-audio-clip' || clip?.type === 'audio';
        const hasEligibleMidiContent =
            input.capability !== 'editable-midi-clip' || (clip?.type === 'midi' && clip.noteCount > 0);
        if (
            !clip ||
            (requiresEditableClip && clip.locked === true) ||
            !hasEligibleAudioContent ||
            !hasEligibleMidiContent
        ) {
            return { status: 'rejected', reason: 'ungrounded-target' };
        }
        const ownerReference = resolveTrackOwnerReference(input.prompt, input.context);
        const hasQualifiedClipReference = [clip.id, clip.name].some((reference) =>
            containsQualifiedClipReference(input.prompt, reference)
        );
        const hasSafeLiteralId =
            evidenceById.get(input.assertedId) === 'literal-id' &&
            !reservedClipReferenceWords.has(normalizeReferenceText(clip.id));
        const requiresQualification =
            hasNonClipReferenceCollision(clip, input.context) ||
            reservedClipReferenceWords.has(normalizeReferenceText(clip.id)) ||
            reservedClipReferenceWords.has(normalizeReferenceText(clip.name));
        if (
            requiresQualification &&
            !hasSafeLiteralId &&
            !hasExplicitClipSelection(input.prompt) &&
            !hasQualifiedClipReference &&
            ownerReference.status !== 'unique'
        ) {
            return { status: 'rejected', reason: 'ungrounded-target' };
        }
    }

    const evidence = evidenceById.get(input.assertedId) ?? 'exact-name';
    const candidate = candidates.find((item) => item.id === input.assertedId)!;
    const confidence = confidenceByEvidence[evidence];
    const evidenceReceipt = [
        { kind: evidence, value: getEvidenceValue(evidence, candidate, input.prompt, input.context, candidates) },
    ];
    const risky = input.effectRisk !== undefined && riskyEffectLevels.has(input.effectRisk);
    if (risky && confidence < 0.9 && input.mode !== 'preview') {
        return {
            status: 'rejected',
            reason: 'preview-required',
            candidateIds: [input.assertedId],
            candidates: [{ id: input.assertedId, confidence, evidence: evidenceReceipt }],
        };
    }

    return { status: 'resolved', id: input.assertedId, evidence, confidence, evidenceReceipt };
}
