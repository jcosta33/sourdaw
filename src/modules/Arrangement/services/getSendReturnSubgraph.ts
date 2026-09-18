import { type Track } from '../models/Track';

type SidechainRouteInput = {
    sourceTrackId: string;
    targetTrackId: string;
};

export type SendReturnSubgraph = {
    /**
     * Return-bus track ids reachable from the target through outgoing sends.
     * Their processed output belongs in the bounce print; a bus outside the
     * target's upstream never reaches a subgraph renderer's destination on its
     * own, because routing walks inputs, not outputs.
     */
    returnTrackIds: Set<string>;
    /**
     * Sidechain key tracks feeding the returns' own devices (direct sources
     * only). The caller expands each key's upstream with `getUpstreamSubgraph`,
     * the same full-upstream treatment the target's own keys get, so the
     * detector hears what live hears. Keys never print: only their detector
     * feed is wired.
     */
    keyTrackIds: Set<string>;
};

/**
 * Collect the send-return half of a bounce subgraph.
 *
 * `getUpstreamSubgraph` walks routing inputs, so an ordinary outgoing return is
 * downstream of the target and never enters it. "Include Sends" promises the
 * captured return effects, which the renderer can only deliver if the return
 * buses are in the render graph — so this walk starts at the target's own
 * sends and follows send edges outward: a return that itself sends into another
 * return is collected too.
 *
 * Scope stays target-only where returns are shared. A bus that other tracks
 * also send into still joins the graph, but those other senders do not: the
 * renderer wires send edges only for tracks it is handed, so the print carries
 * the target's contribution through the return and nothing else's. For the same
 * reason the walk never pulls a return's send-upstream or output-upstream —
 * that content belongs to other sources, not to this bounce.
 */
export function getSendReturnSubgraph(
    targetTrackId: string,
    allTracks: Track[],
    allSidechainRoutes: SidechainRouteInput[]
): SendReturnSubgraph {
    const trackById = new Map(allTracks.map((track) => [track.id, track]));

    const returnTrackIds = new Set<string>();
    const visited = new Set<string>([targetTrackId]);
    const toProcess = [targetTrackId];
    while (toProcess.length > 0) {
        const currentId = toProcess.shift()!;
        for (const send of trackById.get(currentId)?.sends ?? []) {
            if (visited.has(send.busId) || !trackById.has(send.busId)) {
                continue;
            }
            visited.add(send.busId);
            returnTrackIds.add(send.busId);
            toProcess.push(send.busId);
        }
    }

    const keyTrackIds = new Set<string>();
    for (const route of allSidechainRoutes) {
        if (!returnTrackIds.has(route.targetTrackId)) {
            continue;
        }
        if (keyTrackIds.has(route.sourceTrackId) || route.sourceTrackId === targetTrackId) {
            continue;
        }
        keyTrackIds.add(route.sourceTrackId);
    }

    return { returnTrackIds, keyTrackIds };
}
