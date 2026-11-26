import { selectSubgraphPrintInput } from '#/modules/AudioEngine/useCases';

import { type Track } from '../../models/Track';
import { type OfflineRenderSubgraph, selectOfflineRenderSubgraph } from '../selectOfflineRenderSubgraph';

export type FreezePrintSource = Parameters<typeof selectSubgraphPrintInput>[0]['source'];
export type FreezePrintInput = ReturnType<typeof selectSubgraphPrintInput>;

export type FreezePrintSelection = {
    target: Track;
    subgraph: OfflineRenderSubgraph;
    input: FreezePrintInput;
};

/**
 * The tracks a freeze of one track renders from `source`, through the render's own subgraph
 * selection, and the input that render prints from them. Null when the track is gone.
 */
export function selectFreezePrintInput(trackId: string, source: FreezePrintSource): FreezePrintSelection | null {
    const allTracks = source.tracks?.tracks ?? [];
    const target = allTracks.find((candidate) => candidate.id === trackId);
    if (!target) {
        return null;
    }
    const subgraph = selectOfflineRenderSubgraph({
        targetTrack: target,
        allTracks,
        sidechainRoutes: source.sidechainRoutes,
        includeSendReturns: true,
    });
    const input = selectSubgraphPrintInput({ targetTrackId: trackId, renderTracks: subgraph.renderTracks, source });
    return { target, subgraph, input };
}
