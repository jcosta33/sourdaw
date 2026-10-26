import { type ProjectContext } from '../../models/ProjectContext';

import { getAgentReferenceCapabilityKind } from './agentReferenceCapabilityKinds';
import { hasExplicitClipSelection } from './hasExplicitClipSelection';
import { hasExplicitTrackSelection } from './hasExplicitTrackSelection';
import {
    isAgentReferenceCapabilityCandidate,
    type AgentReferenceCapability,
} from './isAgentReferenceCapabilityCandidate';
import { namesTrackAsQualifiedOwner } from './namesTrackAsQualifiedOwner';
import { resolveTrackOwnerReference } from './resolveTrackOwnerReference';

/** One project object the prompt could be naming, drawn from the capability's collection. */
export type AgentReferenceCandidate = {
    id: string;
    name: string;
    ownerQualified: boolean;
};

export type AgentReferenceCandidateInput = {
    prompt: string;
    capability: AgentReferenceCapability;
    context: ProjectContext;
    dependencyId?: string;
};

type Track = ProjectContext['tracks'][number];

function getTrackCandidates({ capability, context }: AgentReferenceCandidateInput): AgentReferenceCandidate[] {
    return context.tracks
        .filter((track) => isAgentReferenceCapabilityCandidate({ capability, context, id: track.id }))
        .map((track) => ({ id: track.id, name: track.name, ownerQualified: false }));
}

/** The tracks an owner-qualified phrase narrows to ("the EQ on Vocals"): one, none when it names several, or all. */
function getOwnerQualifiedTracks(prompt: string, context: ProjectContext): readonly Track[] {
    const ownerReference = resolveTrackOwnerReference(prompt, context);
    if (ownerReference.status === 'ambiguous') {
        return [];
    }
    if (ownerReference.status === 'unique') {
        return context.tracks.filter((track) => track.id === ownerReference.id);
    }
    return context.tracks;
}

/** The selected track when the prompt refers to it ("this track"), otherwise the owner-qualified tracks. */
function getSelectedOrOwnerQualifiedTracks(prompt: string, context: ProjectContext): readonly Track[] {
    if (!hasExplicitTrackSelection(prompt)) {
        return getOwnerQualifiedTracks(prompt, context);
    }
    return context.tracks.filter((track) => track.id === context.selectedTrackId);
}

function getClipCandidates({ prompt, context }: AgentReferenceCandidateInput): AgentReferenceCandidate[] {
    const tracks = hasExplicitClipSelection(prompt) ? context.tracks : getOwnerQualifiedTracks(prompt, context);
    return tracks.flatMap((track) => {
        const ownerQualified = namesTrackAsQualifiedOwner(prompt, track);
        return track.clips.map((clip) => ({ id: clip.id, name: clip.name, ownerQualified }));
    });
}

/** The dependency's track when one is given, otherwise the selected or owner-qualified tracks. */
function getDeviceOwnerTracks({ prompt, context, dependencyId }: AgentReferenceCandidateInput): readonly Track[] {
    if (dependencyId) {
        return context.tracks.filter((track) => track.id === dependencyId);
    }
    return getSelectedOrOwnerQualifiedTracks(prompt, context);
}

function getDeviceCandidates(input: AgentReferenceCandidateInput): AgentReferenceCandidate[] {
    const { prompt, capability, context } = input;
    const tracks = getDeviceOwnerTracks(input);
    const canonicalNamesByType = new Map(
        (context.availableDeviceTypes ?? []).map((deviceType) => [deviceType.id, deviceType.name])
    );
    return tracks.flatMap((track) => {
        const ownerQualified = namesTrackAsQualifiedOwner(prompt, track);
        return track.devices
            .filter((device) =>
                isAgentReferenceCapabilityCandidate({ capability, context, dependencyId: track.id, id: device.id })
            )
            .map((device) => ({
                id: device.id,
                name: canonicalNamesByType.get(device.type) ?? device.type,
                ownerQualified,
            }));
    });
}

function getDeviceParameterCandidates({
    context,
    dependencyId,
}: AgentReferenceCandidateInput): AgentReferenceCandidate[] {
    if (!dependencyId) {
        return [];
    }
    const device = context.tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === dependencyId);
    return (device?.parameters ?? []).map((parameter) => ({
        id: parameter.id,
        name: parameter.name,
        ownerQualified: false,
    }));
}

/** The lanes of the selected track when the prompt refers to it, otherwise of an owner-qualified track, or all. */
function getNarrowedAutomationLanes(prompt: string, context: ProjectContext) {
    const lanes = context.automationLanes ?? [];
    if (hasExplicitTrackSelection(prompt)) {
        return lanes.filter((lane) => lane.trackId === context.selectedTrackId);
    }
    const ownerReference = resolveTrackOwnerReference(prompt, context);
    if (ownerReference.status === 'ambiguous') {
        return [];
    }
    if (ownerReference.status === 'unique') {
        return lanes.filter((lane) => lane.trackId === ownerReference.id);
    }
    return lanes;
}

function getAutomationLaneCandidates({ prompt, context }: AgentReferenceCandidateInput): AgentReferenceCandidate[] {
    return getNarrowedAutomationLanes(prompt, context).map((lane) => {
        const owner = context.tracks.find((track) => track.id === lane.trackId);
        return {
            id: lane.id,
            name: lane.name,
            ownerQualified: owner !== undefined && namesTrackAsQualifiedOwner(prompt, owner),
        };
    });
}

/**
 * The objects of the capability the prompt can refer to before any is read from it: an owned object
 * only on the dependency, or on the selected or owner-qualified track ("the EQ on Vocals") when the
 * prompt narrows to one.
 */
export function getAgentReferenceCandidates(input: AgentReferenceCandidateInput): AgentReferenceCandidate[] {
    const kind = getAgentReferenceCapabilityKind(input.capability);
    if (kind === 'track') {
        return getTrackCandidates(input);
    }
    if (kind === 'clip') {
        return getClipCandidates(input);
    }
    if (input.capability === 'device' || input.capability === 'sidechain-capable-device') {
        return getDeviceCandidates(input);
    }
    if (input.capability === 'device-parameter') {
        return getDeviceParameterCandidates(input);
    }
    if (input.capability === 'automation-lane') {
        return getAutomationLaneCandidates(input);
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
