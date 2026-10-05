import { renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';

import { type OfflineRenderSubgraph } from './selectOfflineRenderSubgraph';

type RenderAgentMeasurementTargetInput = {
    targetId: string;
    subgraph: OfflineRenderSubgraph;
    startBeat: number;
    endBeat: number;
    abortSignal?: AbortSignal;
    onWarning: (message: string) => void;
    /**
     * The document `subgraph` was selected from, when that is not the live
     * project — an isolated command preview. The render then reads that
     * document alone.
     */
    source?: Parameters<typeof renderTrackSubgraphOffline>[0]['source'];
};

/**
 * Render one track or bus measurement target through its isolated offline
 * subgraph: finished audio of the range alone, with the target's own fader,
 * inserts, automation and send returns, and no tail.
 */
export async function renderAgentMeasurementTarget({
    targetId,
    subgraph,
    startBeat,
    endBeat,
    abortSignal,
    onWarning,
    source,
}: RenderAgentMeasurementTargetInput): Promise<AudioBuffer | null> {
    return renderTrackSubgraphOffline({
        targetTrackId: targetId,
        renderTracks: subgraph.renderTracks,
        printTrackIds: subgraph.printTrackIds,
        startBeat,
        endBeat,
        tailSeconds: 0,
        targetMixer: 'bake',
        includeInserts: true,
        includeAutomation: true,
        includeSends: true,
        // A measurement's buffer is never replayed through a live strip, so the
        // target's own VCA group master has to be baked in here or it is
        // dropped from the figure entirely. See `resolveContributorVcaMultiplier`.
        includeTargetVca: true,
        onWarning,
        abortSignal,
        source,
    });
}
