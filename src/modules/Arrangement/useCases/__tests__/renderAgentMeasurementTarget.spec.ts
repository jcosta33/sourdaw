import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { renderAgentMeasurementTarget } from '../renderAgentMeasurementTarget';
import { type OfflineRenderSubgraph } from '../selectOfflineRenderSubgraph';

const mocks = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    renderTrackSubgraphOffline: mocks.renderTrackSubgraphOffline,
}));

function subgraph(): OfflineRenderSubgraph {
    const target = TrackDummy.create({ id: 'track-1' });
    const upstream = TrackDummy.create({ id: 'up-1', outputId: 'track-1' });
    return { renderTracks: [target, upstream], printTrackIds: [] };
}

describe('renderAgentMeasurementTarget', () => {
    beforeEach(() => {
        mocks.renderTrackSubgraphOffline.mockReset().mockResolvedValue(null);
    });

    it('renders the isolated subgraph with the target baked and its own VCA group included', async () => {
        const graph = subgraph();
        const onWarning = vi.fn();
        const abortController = new AbortController();

        await renderAgentMeasurementTarget({
            targetId: 'track-1',
            subgraph: graph,
            startBeat: 16,
            endBeat: 32,
            abortSignal: abortController.signal,
            onWarning,
        });

        expect(mocks.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(mocks.renderTrackSubgraphOffline).toHaveBeenCalledWith({
            targetTrackId: 'track-1',
            renderTracks: graph.renderTracks,
            printTrackIds: graph.printTrackIds,
            startBeat: 16,
            endBeat: 32,
            tailSeconds: 0,
            targetMixer: 'bake',
            includeInserts: true,
            includeAutomation: true,
            includeSends: true,
            includeTargetVca: true,
            onWarning,
            abortSignal: abortController.signal,
        });
    });

    it('passes through the render buffer and forwards no abort signal when the caller gives none', async () => {
        const buffer = { length: 4 } as unknown as AudioBuffer;
        mocks.renderTrackSubgraphOffline.mockResolvedValue(buffer);

        const result = await renderAgentMeasurementTarget({
            targetId: 'track-1',
            subgraph: subgraph(),
            startBeat: 0,
            endBeat: 4,
            onWarning: vi.fn(),
        });

        expect(result).toBe(buffer);
        expect(mocks.renderTrackSubgraphOffline.mock.calls[0]?.[0]).toMatchObject({ abortSignal: undefined });
    });
});
