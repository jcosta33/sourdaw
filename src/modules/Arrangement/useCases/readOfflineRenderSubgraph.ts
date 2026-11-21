import { sidechainStore } from '#/modules/Routing/stores';

import { type Track } from '../models/Track';
import { trackStore } from '../stores/trackStore';

import { type OfflineRenderSubgraph, selectOfflineRenderSubgraph } from './selectOfflineRenderSubgraph';

/**
 * The render subgraph of one target over the live track list and sidechain routes. The offline
 * render and a freeze's source signature both read it here, so the tracks a freeze hashes are the
 * tracks its render builds.
 */
export function readOfflineRenderSubgraph(targetTrack: Track, includeSendReturns: boolean): OfflineRenderSubgraph {
    return selectOfflineRenderSubgraph({
        targetTrack,
        allTracks: trackStore.value?.tracks ?? [],
        sidechainRoutes: sidechainStore.value?.routes ?? [],
        includeSendReturns,
    });
}
