import { createRuntimeGraphTopologyFingerprint } from '#/modules/AudioEngine/useCases';

import { getAllTracks } from '../repositories/track/getAllTracks';

import type { Track, TrackKind } from '../stores/trackStore';

export type RuntimeGraphTopologyNode = Readonly<{
    id: string;
    kind: TrackKind;
    devices: readonly Readonly<{
        id: string;
        type: string;
        externalInstanceId?: string;
        parameterIds: readonly string[];
    }>[];
}>;

/** Builds the graph-protocol shape from the Arrangement-owned project record. */
function createRuntimeGraphTopologyNode(track: Track): RuntimeGraphTopologyNode {
    return {
        id: track.id,
        kind: track.kind,
        devices: track.devices.map((device) => ({
            id: device.id,
            type: device.type,
            ...(device.externalInstanceId !== undefined ? { externalInstanceId: device.externalInstanceId } : {}),
            parameterIds: Object.keys(device.parameterValues).sort((left, right) => left.localeCompare(right)),
        })),
    };
}

/**
 * Compares compiled topology to exactly one current project owner per node.
 * Parameter values stay out of this topology identity; their IDs describe the
 * available control shape, not a claim that a runtime value was restored.
 */
function doesRuntimeGraphDeltaMatchCurrentProjectTopology(nodes: readonly RuntimeGraphTopologyNode[]): boolean {
    const tracks = getAllTracks();
    return nodes.every((node) => {
        const matches = tracks.filter((track) => track.id === node.id);
        if (matches.length !== 1) {
            return false;
        }
        const track = matches[0];
        return (
            track !== undefined &&
            createRuntimeGraphTopologyFingerprint(createRuntimeGraphTopologyNode(track)) ===
                createRuntimeGraphTopologyFingerprint(node)
        );
    });
}

function doesTrackMatchRuntimeGraphTopologyNode(track: Track, node: RuntimeGraphTopologyNode): boolean {
    return (
        createRuntimeGraphTopologyFingerprint(createRuntimeGraphTopologyNode(track)) ===
        createRuntimeGraphTopologyFingerprint(node)
    );
}

/** One Arrangement-owned topology contract shared by graph compilation and bootstrap validation. */
export const runtimeGraphTopology = Object.freeze({
    createNode: createRuntimeGraphTopologyNode,
    matchesNode: doesTrackMatchRuntimeGraphTopologyNode,
    matchesCurrentProject: doesRuntimeGraphDeltaMatchCurrentProjectTopology,
});
