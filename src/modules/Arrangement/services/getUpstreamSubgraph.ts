import { type Track } from '../models/Track';
import { type SidechainRoute } from '#/modules/Routing/models/SidechainRoute';

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
    allSidechainRoutes: SidechainRoute[]
): Set<string> {
    const upstream = new Set<string>();
    const toProcess = [trackId];
    const visited = new Set<string>();

    while (toProcess.length > 0) {
        const currentId = toProcess.pop()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        // 1. Check output routing: which tracks output to currentId?
        for (const t of allTracks) {
            if (t.outputId === currentId) {
                upstream.add(t.id);
                toProcess.push(t.id);
            }
        }

        // 2. Check sends: which tracks send to currentId?
        for (const t of allTracks) {
            if (t.sends.some((s) => s.busId === currentId)) {
                upstream.add(t.id);
                toProcess.push(t.id);
            }
        }

        // 3. Check sidechains: which tracks sidechain into currentId?
        for (const r of allSidechainRoutes) {
            if (r.targetTrackId === currentId) {
                upstream.add(r.sourceTrackId);
                toProcess.push(r.sourceTrackId);
            }
        }
    }

    // Remove the target track itself from the upstream set
    upstream.delete(trackId);
    return upstream;
}
