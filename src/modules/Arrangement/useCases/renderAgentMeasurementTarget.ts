import { renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';

import { type OfflineRenderSubgraph } from './selectOfflineRenderSubgraph';

type RenderAgentMeasurementTargetInput = {
    targetId: string;
    subgraph: OfflineRenderSubgraph;
    startBeat: number;
    endBeat: number;
    abortSignal?: AbortSignal;
    onWarning: (message: string) => void;
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
        onWarning,
        abortSignal,
    });
}
