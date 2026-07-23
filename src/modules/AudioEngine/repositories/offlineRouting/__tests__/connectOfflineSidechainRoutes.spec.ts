import { describe, expect, it, vi } from 'vitest';

import { connectOfflineSidechainRoutes } from '../connectOfflineSidechainRoutes';

type ConnectInput = Parameters<typeof connectOfflineSidechainRoutes>[0];
type DeviceEntries = ConnectInput['deviceEntriesByTrack'] extends ReadonlyMap<string, infer T> ? T : never;
type DeviceEntry = DeviceEntries extends readonly (infer T)[] ? T : never;

function makeStrip(outputNode: AudioNode): { outputNode: AudioNode } {
    return { outputNode };
}

function makeDeviceEntry(inputNode: AudioNode): DeviceEntry {
    return {
        deviceId: 'compressor-1',
        deviceType: 'builtin-sidechain-compressor',
        node: { inputNode, outputNode: inputNode, nodes: [inputNode] },
    };
}

describe('connectOfflineSidechainRoutes', () => {
    it('routes the post-fader source into input one of the target compressor once', () => {
        const sourceConnect = vi.fn();
        const sourceNode = { connect: sourceConnect } as unknown as AudioNode;
        const targetNode = { numberOfInputs: 2 } as AudioNode;
        const routeConnect = vi.fn();
        const routeGain = { gain: { value: 0 }, connect: routeConnect } as unknown as GainNode;
        const createGain = vi.fn(() => routeGain);
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
        ];

        connectOfflineSidechainRoutes({
            offlineCtx: { createGain } as unknown as OfflineAudioContext,
            routes,
            trackStripsById: new Map([['kick', makeStrip(sourceNode)]]),
            deviceEntriesByTrack: new Map([['bass', [makeDeviceEntry(targetNode)]]]),
        });

        expect(routeGain.gain.value).toBe(1);
        expect(sourceConnect).toHaveBeenCalledWith(routeGain);
        expect(routeConnect).toHaveBeenCalledWith(targetNode, 0, 1);
        expect(createGain).toHaveBeenCalledTimes(1);
    });

    it('ignores targets without a two-input built-in sidechain compressor', () => {
        const createGain = vi.fn();
        const singleInput = { numberOfInputs: 1 } as AudioNode;

        connectOfflineSidechainRoutes({
            offlineCtx: { createGain } as unknown as OfflineAudioContext,
            routes: [
                {
                    sourceTrackId: 'kick',
                    targetTrackId: 'bass',
                    targetDeviceId: 'compressor-1',
                    gain: 1,
                },
            ],
            trackStripsById: new Map([['kick', makeStrip({} as AudioNode)]]),
            deviceEntriesByTrack: new Map([['bass', [makeDeviceEntry(singleInput)]]]),
        });

        expect(createGain).not.toHaveBeenCalled();
    });
});
