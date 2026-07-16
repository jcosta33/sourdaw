import { logger } from '#/infra/logger/appLogger';

import { type Track } from '../models/Track';

type SidechainRouteInput = {
    sourceTrackId: string;
    targetTrackId: string;
};

/**
 * Collects the direct upstream predecessors of `nodeId` under the same three
 * routing relations {@link getUpstreamSubgraph} traverses (output, sends,
 * sidechains). Used only for cycle detection — the traversal result itself is
 * still computed by the BFS below.
 */
function getUpstreamPredecessors(
    nodeId: string,
    allTracks: Track[],
    allSidechainRoutes: SidechainRouteInput[]
): string[] {
    const predecessors: string[] = [];
    for (const time of allTracks) {
        if (time.outputId === nodeId || time.sends.some((state) => state.busId === nodeId)) {
            predecessors.push(time.id);
        }
    }
    for (const route of allSidechainRoutes) {
        if (route.targetTrackId === nodeId) {
            predecessors.push(route.sourceTrackId);
        }
    }
    return predecessors;
}

/**
 * Detects a routing cycle reachable upstream of `startId`. A plain visited-set
 * BFS silently truncates cycles (a back-edge to an already-visited node is
 * skipped), so this DFS tracks the active recursion path: revisiting a node
 * that is currently on the path is a genuine back-edge (cycle), while
 * revisiting a completed node is only a diamond join (not a cycle).
 */
function hasUpstreamCycle(startId: string, allTracks: Track[], allSidechainRoutes: SidechainRouteInput[]): boolean {
    const onPath = new Set<string>();
    const completed = new Set<string>();

    function visit(nodeId: string): boolean {
        if (onPath.has(nodeId)) {
            return true;
        }
        if (completed.has(nodeId)) {
            return false;
        }
        onPath.add(nodeId);
        for (const predecessor of getUpstreamPredecessors(nodeId, allTracks, allSidechainRoutes)) {
            if (visit(predecessor)) {
                return true;
            }
        }
        onPath.delete(nodeId);
        completed.add(nodeId);
        return false;
    }

    return visit(startId);
}

/**
 * Finds all tracks that are upstream of the given trackId.
 * Upstream dependencies include:
 * - Output routing: If A outputs to B, A is upstream of B.
 * - Sends: If A sends to Bus B, A is upstream of B.
 * - Sidechains: If A sidechains to B, A is upstream of B.
 */
export function getUpstreamSubgraph(
    trackId: string,
    allTracks: Track[],
    allSidechainRoutes: SidechainRouteInput[]
): Set<string> {
    const upstream = new Set<string>();
    const toProcess = [trackId];
    const visited = new Set<string>();

    while (toProcess.length > 0) {
        const currentId = toProcess.pop()!;
        if (visited.has(currentId)) {
            continue;
        }
        visited.add(currentId);

        // 1. Check output routing: which tracks output to currentId?
        for (const time of allTracks) {
            if (time.outputId === currentId) {
                upstream.add(time.id);
                toProcess.push(time.id);
            }
        }

        // 2. Check sends: which tracks send to currentId?
        for (const time of allTracks) {
            if (time.sends.some((state) => state.busId === currentId)) {
                upstream.add(time.id);
                toProcess.push(time.id);
            }
        }

        // 3. Check sidechains: which tracks sidechain into currentId?
        for (const route of allSidechainRoutes) {
            if (route.targetTrackId === currentId) {
                upstream.add(route.sourceTrackId);
                toProcess.push(route.sourceTrackId);
            }
        }
    }

    // Remove the target track itself from the upstream set
    upstream.delete(trackId);

    // A cyclic routing graph is silently terminated by the visited set above,
    // leaving the bounced/rendered subgraph a truncated DAG that no longer
    // matches live playback. Surface it rather than rendering wrong audio
    // silently — the traversal result is intentionally left unchanged.
    if (hasUpstreamCycle(trackId, allTracks, allSidechainRoutes)) {
        logger.warn(
            `[getUpstreamSubgraph] Routing cycle detected upstream of track "${trackId}". ` +
                'The offline render graph is a DAG; the cyclic routes are truncated, so the ' +
                'rendered audio may not match live playback.'
        );
    }

    return upstream;
}
