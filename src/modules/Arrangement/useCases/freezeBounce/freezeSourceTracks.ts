import { sidechainStore } from '#/modules/Routing/stores';

import { type Track } from '../../models/Track';
import { selectOfflineRenderSubgraph } from '../selectOfflineRenderSubgraph';

/**
 * The tracks a freeze's offline render reads: the target and everything the render subgraph
 * selects for it (outputs routed in, sends, sidechain sources, returns), ordered by track id so
 * equal sources always list the same way. Empty when the target is not in `allTracks`.
 *
 * Selected through the render's own `selectOfflineRenderSubgraph` call, with the render's default
 * of including send returns, so the signature cannot drift from what the render reads.
 */
export function selectFreezeSourceTracks(trackId: string, allTracks: Track[]): Track[] {
    const targetTrack = allTracks.find((candidate) => candidate.id === trackId);
    if (!targetTrack) {
        return [];
    }
    const { renderTracks } = selectOfflineRenderSubgraph({
        targetTrack,
        allTracks,
        sidechainRoutes: sidechainStore.value?.routes ?? [],
        includeSendReturns: true,
    });
    return renderTracks.toSorted((left, right) => left.id.localeCompare(right.id));
}
