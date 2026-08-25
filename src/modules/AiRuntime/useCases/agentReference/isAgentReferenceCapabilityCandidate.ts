import { getSidechainTargetCapability } from '#/utils/getSidechainTargetCapability';

import { type ProjectContext } from '../../models/ProjectContext';

export type AgentReferenceCapability =
    | 'track'
    | 'armable-track'
    | 'duplicable-track'
    | 'removable-track'
    | 'routable-source'
    | 'bus'
    | 'output'
    | 'device-host-track'
    | 'device'
    | 'sidechain-capable-device'
    | 'device-parameter'
    | 'adjustment-layer'
    | 'vca-group'
    | 'vca-member-track'
    | 'automation-lane'
    | 'clip'
    | 'editable-clip'
    | 'editable-audio-clip'
    | 'editable-midi-clip';

const duplicableTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus', 'folder']);
const routableTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus']);
const vcaMemberTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus', 'folder']);

/** Applies the canonical target-capability contract to one immutable-context ID. */
export function isAgentReferenceCapabilityCandidate(input: {
    capability: string;
    context: ProjectContext;
    dependencyId?: string;
    id: string;
}): boolean {
    const track = input.context.tracks.find((candidate) => candidate.id === input.id);
    if (track) {
        if (input.capability === 'track' || input.capability === 'removable-track') {
            return input.capability !== 'removable-track' || track.kind !== 'master';
        }
        if (input.capability === 'armable-track' || input.capability === 'device-host-track') {
            return track.kind !== 'vca';
        }
        if (input.capability === 'duplicable-track') {
            return duplicableTrackKinds.has(track.kind);
        }
        if (input.capability === 'routable-source') {
            return routableTrackKinds.has(track.kind);
        }
        if (input.capability === 'bus') {
            return track.kind === 'bus';
        }
        if (input.capability === 'output') {
            return track.kind === 'bus' || track.kind === 'master';
        }
        if (input.capability === 'vca-member-track') {
            return vcaMemberTrackKinds.has(track.kind);
        }
    }
    if (input.capability === 'device') {
        return input.context.tracks.some(
            (candidate) =>
                (input.dependencyId === undefined || candidate.id === input.dependencyId) &&
                candidate.devices.some((device) => device.id === input.id)
        );
    }
    if (input.capability === 'sidechain-capable-device') {
        return input.context.tracks.some((candidate) =>
            candidate.devices.some(
                (device) => device.id === input.id && getSidechainTargetCapability(device.type) !== null
            )
        );
    }
    if (input.capability === 'device-parameter') {
        return input.context.tracks.some((candidate) =>
            candidate.devices.some(
                (device) =>
                    (input.dependencyId === undefined || device.id === input.dependencyId) &&
                    (device.parameters ?? []).some((parameter) => parameter.id === input.id)
            )
        );
    }
    if (input.capability === 'adjustment-layer') {
        return (input.context.adjustmentLayers ?? []).some((layer) => layer.id === input.id);
    }
    if (input.capability === 'automation-lane') {
        return (input.context.automationLanes ?? []).some((lane) => lane.id === input.id);
    }
    if (input.capability === 'vca-group') {
        return (input.context.vcaGroups ?? []).some((group) => group.id === input.id);
    }
    const clip = input.context.tracks
        .flatMap((candidate) => candidate.clips)
        .find((candidate) => candidate.id === input.id);
    if (!clip || !['clip', 'editable-clip', 'editable-audio-clip', 'editable-midi-clip'].includes(input.capability)) {
        return false;
    }
    if (input.capability === 'clip') {
        return true;
    }
    if (clip.locked === true) {
        return false;
    }
    if (input.capability === 'editable-audio-clip') {
        return clip.type === 'audio';
    }
    return input.capability !== 'editable-midi-clip' || (clip.type === 'midi' && clip.noteCount > 0);
}
