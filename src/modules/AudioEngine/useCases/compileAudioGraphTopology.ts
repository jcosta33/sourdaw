import { hasRoutingCycle } from '#/utils/routingCycle';

type AudioGraphTrack = {
    readonly devices: readonly { readonly id: string; readonly type: string }[];
    readonly id: string;
    readonly kind: string;
    readonly outputId?: string;
    readonly sends: readonly { readonly busId: string; readonly level: number }[];
};

type AudioGraphSidechainRoute = {
    readonly sourceTrackId: string;
    readonly targetDeviceId: string;
    readonly targetTrackId: string;
};

type CompileAudioGraphTopologyInput = {
    readonly sidechainRoutes: readonly AudioGraphSidechainRoute[];
    readonly tracks: readonly AudioGraphTrack[];
};

export type AudioGraphCompilationResult =
    | {
          readonly status: 'compiled';
          readonly edgeCount: number;
          readonly nodeIds: readonly string[];
      }
    | { readonly status: 'invalid'; readonly reason: string };

function createsAudioNode(track: AudioGraphTrack): boolean {
    return track.kind !== 'folder' || track.devices.some((device) => device.type === 'toaster');
}

export function compileAudioGraphTopology(input: CompileAudioGraphTopologyInput): AudioGraphCompilationResult {
    if (
        input.tracks.some(
            (track) =>
                track.kind !== 'audio' &&
                track.kind !== 'midi' &&
                track.kind !== 'bus' &&
                track.kind !== 'master' &&
                track.kind !== 'folder'
        )
    ) {
        return { status: 'invalid', reason: 'Audio graph contains an unsupported track kind' };
    }
    const tracksById = new Map(input.tracks.map((track) => [track.id, track]));
    const nodeIds = new Set(input.tracks.filter(createsAudioNode).map((track) => track.id));
    let edgeCount = 0;

    for (const track of input.tracks) {
        const outputId = track.outputId ?? (track.kind === 'master' ? 'hw_out' : 'master');
        if (createsAudioNode(track)) {
            if (outputId !== 'master' && outputId !== 'hw_out' && !nodeIds.has(outputId)) {
                return { status: 'invalid', reason: `Track output has no audio node: ${track.id} -> ${outputId}` };
            }
            edgeCount++;
        }
        const seenSendTargets = new Set<string>();
        for (const send of track.sends) {
            if (!createsAudioNode(track) || !nodeIds.has(send.busId) || !Number.isFinite(send.level)) {
                return { status: 'invalid', reason: `Send cannot compile: ${track.id} -> ${send.busId}` };
            }
            if (seenSendTargets.has(send.busId)) {
                return { status: 'invalid', reason: `Duplicate send cannot compile: ${track.id} -> ${send.busId}` };
            }
            seenSendTargets.add(send.busId);
            edgeCount++;
        }
    }

    for (const route of input.sidechainRoutes) {
        const target = tracksById.get(route.targetTrackId);
        if (
            !nodeIds.has(route.sourceTrackId) ||
            !nodeIds.has(route.targetTrackId) ||
            !target?.devices.some((device) => device.id === route.targetDeviceId)
        ) {
            return {
                status: 'invalid',
                reason: `Sidechain route cannot compile: ${route.sourceTrackId} -> ${route.targetTrackId}`,
            };
        }
        edgeCount++;
    }

    if (hasRoutingCycle({ tracks: input.tracks, sidechainRoutes: input.sidechainRoutes })) {
        return { status: 'invalid', reason: 'Audio graph contains a routing cycle' };
    }

    return { status: 'compiled', edgeCount, nodeIds: [...nodeIds].sort() };
}
