import { type Track } from '../models/Track';

type SidechainRouteInput = {
    sourceTrackId: string;
    targetTrackId: string;
};

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
    return upstream;
}
