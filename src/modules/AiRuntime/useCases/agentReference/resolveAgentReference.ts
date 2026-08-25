import { type ProjectContext } from '../../models/ProjectContext';

import {
    isAgentReferenceCapabilityCandidate,
    type AgentReferenceCapability,
} from './isAgentReferenceCapabilityCandidate';

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
    if (
        [
            'track',
            'armable-track',
            'duplicable-track',
            'removable-track',
            'routable-source',
            'bus',
            'output',
            'device-host-track',
            'vca-member-track',
        ].includes(capability)
    ) {
        return context.tracks.filter((track) =>
            isAgentReferenceCapabilityCandidate({ capability, context, id: track.id })
        );
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

    if (input.capability === 'adjustment-layer') {
        return (input.context.adjustmentLayers ?? []).map((layer) => ({ id: layer.id, name: layer.name }));
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

    if (evidenceById.size === 0) {
        return { status: 'rejected', reason: 'ungrounded-target' };
    }
    if (evidenceById.size > 1) {
        return { status: 'rejected', reason: 'ambiguous-target', candidateIds: [...evidenceById.keys()] };
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

    return { status: 'resolved', id: input.assertedId, evidence };
}
