import { type getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';

type TargetCapability = NonNullable<
    ReturnType<typeof getExecutableAppActionGroundingRules>
>['targetRules'][number]['capability'];

type OwnerReader = (context: ProjectContext, targetId: string) => string[];

const ownsItself: OwnerReader = () => [];

const findDeviceOwner: OwnerReader = (context, deviceId) => {
    const owner = context.tracks.find((track) => track.devices.some((device) => device.id === deviceId));
    return owner === undefined ? [] : [owner.id];
};

const findClipOwner: OwnerReader = (context, clipId) => {
    const owner = context.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
    return owner === undefined ? [] : [owner.id];
};

const findLaneOwner: OwnerReader = (context, laneId) => {
    const lane = (context.automationLanes ?? []).find((candidate) => candidate.id === laneId);
    return lane === undefined ? [] : [lane.trackId];
};

const findLayerTracks: OwnerReader = (context, layerId) => {
    const layer = (context.adjustmentLayers ?? []).find((candidate) => candidate.id === layerId);
    return layer === undefined ? [] : Array.from(layer.affectedTrackIds);
};

const findVcaMembers: OwnerReader = (context, groupId) => {
    const group = (context.vcaGroups ?? []).find((candidate) => candidate.id === groupId);
    return group === undefined ? [] : Array.from(group.trackIds);
};

/** One reader per target capability, so a capability the registry adds must say whose object it names. */
const OWNER_READERS: Readonly<Record<TargetCapability, OwnerReader>> = {
    track: ownsItself,
    'armable-track': ownsItself,
    'duplicable-track': ownsItself,
    'removable-track': ownsItself,
    'routable-source': ownsItself,
    bus: ownsItself,
    output: ownsItself,
    'device-host-track': ownsItself,
    'vca-member-track': ownsItself,
    'device-parameter': ownsItself,
    device: findDeviceOwner,
    'sidechain-capable-device': findDeviceOwner,
    clip: findClipOwner,
    'editable-clip': findClipOwner,
    'editable-audio-clip': findClipOwner,
    'editable-midi-clip': findClipOwner,
    'writable-midi-clip': findClipOwner,
    'automation-lane': findLaneOwner,
    'adjustment-layer': findLayerTracks,
    'vca-group': findVcaMembers,
};

/**
 * The tracks an existing object a target names belongs to, read by the capability the target takes:
 * a device's or clip's track, an automation lane's track, the tracks an adjustment layer processes
 * and a VCA group's members. A track-like target is its own object, and a device parameter belongs
 * to the device its sibling target names, so neither has an owner here.
 */
export function findTargetOwnerTrackIds(
    capability: TargetCapability,
    targetId: string,
    context: ProjectContext
): string[] {
    return OWNER_READERS[capability](context, targetId);
}
