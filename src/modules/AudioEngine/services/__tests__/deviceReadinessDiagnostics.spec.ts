import { beforeEach, describe, expect, it } from 'vitest';

import { deviceReadinessDiagnostics } from '../deviceReadinessDiagnostics';

describe('deviceReadinessDiagnostics', () => {
    beforeEach(() => {
        deviceReadinessDiagnostics.reset();
    });

    it('records node, graph, and playable readiness for a worklet device', () => {
        const token = deviceReadinessDiagnostics.begin({
            deviceId: 'fermenter-1',
            deviceType: 'fermenter',
            requiresContent: false,
            atMs: 1_000,
        });

        deviceReadinessDiagnostics.markNodeReady({ token, atMs: 1_012 });
        deviceReadinessDiagnostics.markGraphReady({ token, atMs: 1_016 });

        expect(deviceReadinessDiagnostics.snapshot()).toMatchObject({
            counts: {
                requested: 1,
                nodeReady: 1,
                graphReady: 1,
                playableReady: 1,
                failed: 0,
                cancelled: 0,
            },
            devices: [
                {
                    deviceId: 'fermenter-1',
                    deviceType: 'fermenter',
                    status: 'ready',
                    requestToNodeReadyMs: 12,
                    requestToGraphReadyMs: 16,
                    graphToContentReadyMs: null,
                    requestToPlayableReadyMs: 16,
                },
            ],
        });
    });

    it('does not mark a content-backed device playable until its content is ready', () => {
        const token = deviceReadinessDiagnostics.begin({
            deviceId: 'levain-1',
            deviceType: 'levain',
            requiresContent: true,
            atMs: 2_000,
        });

        deviceReadinessDiagnostics.markNodeReady({ token, atMs: 2_010 });
        deviceReadinessDiagnostics.markGraphReady({ token, atMs: 2_014 });
        expect(deviceReadinessDiagnostics.snapshot().devices[0]?.status).toBe('content-pending');

        deviceReadinessDiagnostics.markContentSettled({ token, outcome: 'ready', atMs: 2_035 });

        const snapshot = deviceReadinessDiagnostics.snapshot();
        expect(snapshot.counts.playableReady).toBe(1);
        expect(snapshot.devices[0]).toMatchObject({
            status: 'ready',
            graphToContentReadyMs: 21,
            requestToPlayableReadyMs: 35,
        });
    });

    it('records a zero graph-to-content wait when content is ready before graph connection', () => {
        const token = deviceReadinessDiagnostics.begin({
            deviceId: 'levain-early',
            deviceType: 'levain',
            requiresContent: true,
            atMs: 2_000,
        });

        deviceReadinessDiagnostics.markNodeReady({ token, atMs: 2_010 });
        deviceReadinessDiagnostics.markContentSettled({ token, outcome: 'ready', atMs: 2_012 });
        deviceReadinessDiagnostics.markGraphReady({ token, atMs: 2_015 });

        const snapshot = deviceReadinessDiagnostics.snapshot();
        expect(snapshot.devices[0]).toMatchObject({
            status: 'ready',
            graphToContentReadyMs: 0,
            requestToPlayableReadyMs: 15,
        });
        expect(snapshot.timing.graphToContentReadyMs).toEqual({
            samples: 1,
            totalMs: 0,
            lastMs: 0,
            maxMs: 0,
            averageMs: 0,
        });
    });

    it('rejects stale tokens and keeps cancellation and failure outcomes exact', () => {
        const staleToken = deviceReadinessDiagnostics.begin({
            deviceId: 'levain-1',
            deviceType: 'levain',
            requiresContent: true,
            atMs: 3_000,
        });
        const currentToken = deviceReadinessDiagnostics.begin({
            deviceId: 'levain-1',
            deviceType: 'levain',
            requiresContent: true,
            atMs: 3_010,
        });

        deviceReadinessDiagnostics.markGraphReady({ token: staleToken, atMs: 3_020 });
        deviceReadinessDiagnostics.markFailed({ token: currentToken, stage: 'node', atMs: 3_025 });

        const snapshot = deviceReadinessDiagnostics.snapshot();
        expect(snapshot.counts).toMatchObject({ cancelled: 1, failed: 1, graphReady: 0 });
        expect(snapshot.devices[0]).toMatchObject({
            status: 'failed',
            failureStage: 'node',
            requestToFailureMs: 15,
        });
    });

    it('does not let an async completion from before reset mutate a successor request', () => {
        const staleToken = deviceReadinessDiagnostics.begin({
            deviceId: 'levain-1',
            deviceType: 'levain',
            requiresContent: true,
            atMs: 4_000,
        });
        deviceReadinessDiagnostics.reset();
        const currentToken = deviceReadinessDiagnostics.begin({
            deviceId: 'levain-1',
            deviceType: 'levain',
            requiresContent: true,
            atMs: 5_000,
        });

        deviceReadinessDiagnostics.markGraphReady({ token: staleToken, atMs: 5_010 });
        deviceReadinessDiagnostics.markGraphReady({ token: currentToken, atMs: 5_020 });

        expect(deviceReadinessDiagnostics.snapshot()).toMatchObject({
            counts: { requested: 1, nodeReady: 1, graphReady: 1, playableReady: 0 },
            devices: [{ status: 'content-pending', requestToGraphReadyMs: 20 }],
        });
    });

    it('counts a content-ready completion once while graph connection is pending', () => {
        const token = deviceReadinessDiagnostics.begin({
            deviceId: 'levain-1',
            deviceType: 'levain',
            requiresContent: true,
            atMs: 6_000,
        });

        deviceReadinessDiagnostics.markContentSettled({ token, outcome: 'ready', atMs: 6_010 });
        deviceReadinessDiagnostics.markContentSettled({ token, outcome: 'ready', atMs: 6_012 });
        deviceReadinessDiagnostics.markGraphReady({ token, atMs: 6_015 });

        expect(deviceReadinessDiagnostics.snapshot()).toMatchObject({
            counts: { contentReady: 1, playableReady: 1 },
            devices: [{ graphToContentReadyMs: 0, requestToPlayableReadyMs: 15 }],
        });
    });
});
