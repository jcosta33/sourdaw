import { type Track } from '../models/Track';
import { getSendReturnSubgraph, type SendReturnSubgraph } from '../services/getSendReturnSubgraph';
import { getUpstreamSubgraph } from '../services/getUpstreamSubgraph';
import { getTrackEligibility } from '../stores/trackEligibility';

type SidechainRouteInput = {
    sourceTrackId: string;
    targetTrackId: string;
};

type SelectOfflineRenderSubgraphInput = {
    targetTrack: Track;
    allTracks: Track[];
    sidechainRoutes: SidechainRouteInput[];
    includeSendReturns: boolean;
};

export type OfflineRenderSubgraph = {
    /** The target plus every routing endpoint its render needs, in project order. */
    renderTracks: Track[];
    /** The send-return buses among `renderTracks`, whose output mixes into the print. */
    printTrackIds: string[];
};

/**
 * The tracks an offline render of one target builds, and which of them print.
 *
 * The upstream walk collects everything routed into the target. "Include Sends"
 * promises the captured return effects. An outgoing return is downstream of the
 * target, so the upstream walk never reaches it; this adds the send-return buses
 * (and their sidechain keys' upstream) to the graph and marks them for the
 * mixdown, because a return's own output routing leaves the subgraph and its
 * wet would otherwise print nowhere. The scope stays target-only where returns
 * are shared: the renderer wires send edges only for tracks in `renderTracks`,
 * so a shared return carries this target's contribution and no other sender's.
 */
export function selectOfflineRenderSubgraph({
    targetTrack,
    allTracks,
    sidechainRoutes,
    includeSendReturns,
}: SelectOfflineRenderSubgraphInput): OfflineRenderSubgraph {
    const upstreamIds = getUpstreamSubgraph(targetTrack.id, allTracks, sidechainRoutes);

    let sendReturns: SendReturnSubgraph = { returnTrackIds: new Set<string>(), keyTrackIds: new Set<string>() };
    if (includeSendReturns) {
        sendReturns = getSendReturnSubgraph(targetTrack.id, allTracks, sidechainRoutes);
    }
    const returnSidechainIds = new Set<string>();
    for (const keyTrackId of sendReturns.keyTrackIds) {
        returnSidechainIds.add(keyTrackId);
        for (const upstreamId of getUpstreamSubgraph(keyTrackId, allTracks, sidechainRoutes)) {
            returnSidechainIds.add(upstreamId);
        }
    }

    const renderTracks: Track[] = [];
    for (const candidate of allTracks) {
        const belongsToRenderSubgraph =
            candidate.id === targetTrack.id ||
            upstreamIds.has(candidate.id) ||
            sendReturns.returnTrackIds.has(candidate.id) ||
            returnSidechainIds.has(candidate.id);
        if (!belongsToRenderSubgraph) {
            continue;
        }
        if (!getTrackEligibility(candidate.kind).acceptsRoutingEndpoint) {
            continue;
        }
        renderTracks.push(candidate);
    }
    if (!renderTracks.some((candidate) => candidate.id === targetTrack.id)) {
        renderTracks.unshift(targetTrack);
    }

    return {
        renderTracks,
        printTrackIds: renderTracks
            .filter((track) => sendReturns.returnTrackIds.has(track.id))
            .map((track) => track.id),
    };
}
