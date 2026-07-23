import { describe, expect, it, vi } from 'vitest';

import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { connectOfflineSidechainRoutes } from '../connectOfflineSidechainRoutes';
import { type OfflineTrackStrip } from '../types';

function makeStrip(outputNode: GainNode): OfflineTrackStrip {
    return {
        inputNode: {} as GainNode,
        preFaderTap: {} as GainNode,
        faderNode: {} as GainNode,
        postFaderGain: {} as GainNode,
        panNode: {} as StereoPannerNode,
        outputNode,
        deviceEntries: [],
    };
}

describe('connectOfflineSidechainRoutes', () => {
    it('routes the post-fader source into input one of the target compressor', () => {
        const sourceConnect = vi.fn();
        const sourceNode = { connect: sourceConnect } as unknown as GainNode;
        const targetNode = { numberOfInputs: 2 } as AudioNode;
        const routeConnect = vi.fn();
        const routeGain = { gain: { value: 0 }, connect: routeConnect } as unknown as GainNode;
        const createGain = vi.fn(() => routeGain);
        const targetEntry = {
            deviceId: 'compressor-1',
            deviceType: 'builtin-sidechain-compressor',
            node: { inputNode: targetNode, outputNode: targetNode, nodes: [targetNode] },
        } as unknown as DeviceNodeEntry;

        connectOfflineSidechainRoutes({
            offlineCtx: { createGain } as unknown as OfflineAudioContext,
            routes: [
                {
                    id: 'route-1',
                    sourceTrackId: 'kick',
                    targetTrackId: 'bass',
                    targetDeviceId: 'compressor-1',
                    targetParameterId: 'sc-comp-threshold',
                    gain: 0.75,
                },
                {
                    id: 'duplicate-route',
                    sourceTrackId: 'kick',
                    targetTrackId: 'bass',
                    targetDeviceId: 'compressor-1',
                    targetParameterId: 'sc-comp-threshold',
                    gain: 1,
                },
            ],
            trackStripsById: new Map([['kick', makeStrip(sourceNode)]]),
            deviceEntriesByTrack: new Map([['bass', [targetEntry]]]),
        });

        expect(routeGain.gain.value).toBe(0.75);
        expect(sourceConnect).toHaveBeenCalledWith(routeGain);
        expect(routeConnect).toHaveBeenCalledWith(targetNode, 0, 1);
        expect(createGain).toHaveBeenCalledTimes(1);
    });

    it('ignores targets without a two-input built-in sidechain compressor', () => {
        const createGain = vi.fn();
        const singleInput = { numberOfInputs: 1 } as AudioNode;
        const targetEntry = {
            deviceId: 'compressor-1',
            deviceType: 'builtin-sidechain-compressor',
            node: { inputNode: singleInput, outputNode: singleInput, nodes: [singleInput] },
        } as unknown as DeviceNodeEntry;

        connectOfflineSidechainRoutes({
            offlineCtx: { createGain } as unknown as OfflineAudioContext,
            routes: [
                {
                    id: 'route-1',
                    sourceTrackId: 'kick',
                    targetTrackId: 'bass',
                    targetDeviceId: 'compressor-1',
                    targetParameterId: 'sc-comp-threshold',
                    gain: 1,
                },
            ],
            trackStripsById: new Map([['kick', makeStrip({} as GainNode)]]),
            deviceEntriesByTrack: new Map([['bass', [targetEntry]]]),
        });

        expect(createGain).not.toHaveBeenCalled();
    });
});
