import { describe, it, expect, vi } from 'vitest';

import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { wireOfflineSidechainRoutes } from '../wireOfflineSidechainRoutes';
import { type OfflineTrackStrip } from '../types';

function makeGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
}

function makeStrip(): OfflineTrackStrip {
    return {
        inputNode: makeGain(),
        preFaderTap: makeGain(),
        faderNode: makeGain(),
        postFaderGain: makeGain(),
        panNode: { pan: { value: 0 }, connect: vi.fn() } as unknown as StereoPannerNode,
        outputNode: makeGain(),
        deviceEntries: [],
    } as unknown as OfflineTrackStrip;
}

function makeCtx() {
    const createdGains: Array<ReturnType<typeof makeGain>> = [];
    const ctx = {
        createGain: vi.fn(() => {
            const gain = makeGain();
            createdGains.push(gain);
            return gain;
        }),
    } as unknown as OfflineAudioContext;
    return { ctx, createdGains };
}

describe('wireOfflineSidechainRoutes (M-041)', () => {
    /// Regression: offline exports mapped builtin-sidechain-compressor to a
    /// plain compressor with no key input, so sidechain ducking was silently
    /// absent from exports. The offline graph must mirror the live engine:
    /// source analyserNode (post-fader/pan/mute — the strip's outputNode
    /// offline) → gain → compressor sidechain input (index 1).
    it('connects the source tap to the compressor sidechain input through a gain', () => {
        const { ctx, createdGains } = makeCtx();
        const sourceStrip = makeStrip();
        const compressorNode = makeGain();
        const strips = new Map<string, OfflineTrackStrip>([['source-track', sourceStrip]]);
        const entries = new Map<string, DeviceNodeEntry[]>([
            [
                'target-track',
                [
                    {
                        deviceId: 'sc-comp-1',
                        deviceType: 'builtin-sidechain-compressor',
                        node: { inputNode: compressorNode, outputNode: makeGain(), nodes: [compressorNode] },
                    } as unknown as DeviceNodeEntry,
                ],
            ],
        ]);

        wireOfflineSidechainRoutes(ctx, strips, entries, [
            { sourceTrackId: 'source-track', targetTrackId: 'target-track', targetDeviceId: 'sc-comp-1' },
        ]);

        expect(createdGains).toHaveLength(1);
        const scGain = createdGains[0]!;
        expect(sourceStrip.outputNode.connect).toHaveBeenCalledWith(scGain);
        expect(scGain.connect).toHaveBeenCalledWith(compressorNode, 0, 1);
    });

    it('skips routes whose source strip or sidechain target is missing', () => {
        const { ctx } = makeCtx();
        const strips = new Map<string, OfflineTrackStrip>([['source-track', makeStrip()]]);
        const entries = new Map<string, DeviceNodeEntry[]>([
            [
                'target-track',
                [
                    {
                        deviceId: 'plain-comp',
                        deviceType: 'builtin-compressor',
                        node: { inputNode: makeGain(), outputNode: makeGain(), nodes: [] },
                    } as unknown as DeviceNodeEntry,
                ],
            ],
        ]);

        wireOfflineSidechainRoutes(ctx, strips, entries, [
            { sourceTrackId: 'source-track', targetTrackId: 'target-track', targetDeviceId: 'plain-comp' },
            { sourceTrackId: 'missing-source', targetTrackId: 'target-track', targetDeviceId: 'plain-comp' },
        ]);

        expect(ctx.createGain).not.toHaveBeenCalled();
    });
});
