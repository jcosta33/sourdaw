import { describe, expect, it, vi } from 'vitest';

import { connectOfflineSidechainRoutes } from '../connectOfflineSidechainRoutes';

function makeStrip(outputNode: AudioNode): { outputNode: AudioNode } {
    return { outputNode };
}

function makeDeviceEntry(inputNode: AudioNode) {
    return {
        deviceId: 'compressor-1',
        deviceType: 'builtin-sidechain-compressor',
        node: { inputNode, outputNode: inputNode, nodes: [inputNode] },
    };
}

describe('connectOfflineSidechainRoutes', () => {
    it('routes each exact target once even when device ids repeat across tracks', () => {
        const sourceConnect = vi.fn();
        const sourceNode = { connect: sourceConnect } as unknown as AudioNode;
        const targetNode = { numberOfInputs: 2 } as AudioNode;
        const otherTargetNode = { numberOfInputs: 2 } as AudioNode;
        const routeConnect = vi.fn();
        const otherRouteConnect = vi.fn();
        const routeGain = { gain: { value: 0 }, connect: routeConnect } as unknown as GainNode;
        const otherRouteGain = { gain: { value: 0 }, connect: otherRouteConnect } as unknown as GainNode;
        const createGain = vi.fn().mockReturnValueOnce(routeGain).mockReturnValueOnce(otherRouteGain);
        const keyDelay = { delayTime: { value: -1 }, connect: vi.fn() } as unknown as DelayNode;
        const otherKeyDelay = { delayTime: { value: -1 }, connect: vi.fn() } as unknown as DelayNode;
        const createDelay = vi.fn().mockReturnValueOnce(keyDelay).mockReturnValueOnce(otherKeyDelay);
        const routes = [
            {
                sourceTrackId: 'kick',
                targetTrackId: 'bass',
                targetDeviceId: 'compressor-1',
                gain: 0.75,
            },
            {
                sourceTrackId: 'kick',
                targetTrackId: 'bass',
                targetDeviceId: 'compressor-1',
                gain: 1,
            },
            {
                sourceTrackId: 'kick',
                targetTrackId: 'other-bass',
                targetDeviceId: 'compressor-1',
                gain: 1,
            },
        ];

        connectOfflineSidechainRoutes({
            offlineCtx: { createGain, createDelay } as unknown as OfflineAudioContext,
            routes,
            trackStripsById: new Map([['kick', makeStrip(sourceNode)]]),
            deviceEntriesByTrack: new Map([
                ['bass', [makeDeviceEntry(targetNode)]],
                ['other-bass', [makeDeviceEntry(otherTargetNode)]],
            ]),
            keyDelaySecFor: (route) => (route.targetTrackId === 'bass' ? 0.03 : 0),
        });

        expect(routeGain.gain.value).toBe(1);
        // FX-5 — the tap now feeds the alignment line, which feeds the route gain.
        expect(sourceConnect).toHaveBeenCalledWith(keyDelay);
        expect(sourceConnect).not.toHaveBeenCalledWith(routeGain);
        expect(keyDelay.connect).toHaveBeenCalledWith(routeGain);
        expect(routeConnect).toHaveBeenCalledWith(targetNode, 0, 1);
        expect(otherRouteConnect).toHaveBeenCalledWith(otherTargetNode, 0, 1);
        expect(createGain).toHaveBeenCalledTimes(2);
        expect(createDelay).toHaveBeenCalledTimes(2);
    });

    it('sets each route own resolved key delay on its alignment line (FX-5)', () => {
        const sourceNode = { connect: vi.fn() } as unknown as AudioNode;
        const targetNode = { numberOfInputs: 2 } as AudioNode;
        const otherTargetNode = { numberOfInputs: 2 } as AudioNode;
        const makeGain = () => ({ gain: { value: 0 }, connect: vi.fn() }) as unknown as GainNode;
        const createGain = vi.fn(makeGain);
        const keyDelay = { delayTime: { value: -1 }, connect: vi.fn() } as unknown as DelayNode;
        const otherKeyDelay = { delayTime: { value: -1 }, connect: vi.fn() } as unknown as DelayNode;
        const createDelay = vi.fn().mockReturnValueOnce(keyDelay).mockReturnValueOnce(otherKeyDelay);

        connectOfflineSidechainRoutes({
            offlineCtx: { createGain, createDelay } as unknown as OfflineAudioContext,
            routes: [
                { sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'compressor-1' },
                { sourceTrackId: 'kick', targetTrackId: 'pad', targetDeviceId: 'compressor-1' },
            ],
            trackStripsById: new Map([['kick', makeStrip(sourceNode)]]),
            deviceEntriesByTrack: new Map([
                ['bass', [makeDeviceEntry(targetNode)]],
                ['pad', [makeDeviceEntry(otherTargetNode)]],
            ]),
            // A negative resolution is unrepresentable on a delay line and must
            // clamp rather than throw or pass through.
            keyDelaySecFor: (route) => (route.targetTrackId === 'bass' ? 0.03 : -0.5),
        });

        expect(keyDelay.delayTime.value).toBeCloseTo(0.03, 10);
        expect(otherKeyDelay.delayTime.value).toBe(0);
    });

    it('ignores targets without a two-input built-in sidechain compressor', () => {
        const createGain = vi.fn();
        const createDelay = vi.fn();
        const singleInput = { numberOfInputs: 1 } as AudioNode;

        connectOfflineSidechainRoutes({
            offlineCtx: { createGain, createDelay } as unknown as OfflineAudioContext,
            routes: [
                {
                    sourceTrackId: 'kick',
                    targetTrackId: 'bass',
                    targetDeviceId: 'compressor-1',
                },
            ],
            trackStripsById: new Map([['kick', makeStrip({} as AudioNode)]]),
            deviceEntriesByTrack: new Map([['bass', [makeDeviceEntry(singleInput)]]]),
            keyDelaySecFor: () => 0.03,
        });

        expect(createGain).not.toHaveBeenCalled();
        expect(createDelay).not.toHaveBeenCalled();
    });
});
