import { afterEach, describe, expect, it, vi } from 'vitest';

import { applySidechainCompressorParams } from '../applySidechainCompressorParams';
import { createSidechainCompressorFallback } from '../createSidechainCompressorFallback';
import { prepareOfflineSidechainCompressor } from '../prepareOfflineSidechainCompressor';

function makeFallbackContext(): {
    compressor: DynamicsCompressorNode;
    context: OfflineAudioContext;
    makeup: GainNode;
} {
    const compressor = {
        threshold: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
        knee: { value: 0 },
        connect: vi.fn(),
    } as unknown as DynamicsCompressorNode;
    const makeup = { gain: { value: 0 } } as GainNode;
    const addModule = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const context = {
        audioWorklet: { addModule },
        createDynamicsCompressor: vi.fn(() => compressor),
        createGain: vi.fn(() => makeup),
    } as unknown as OfflineAudioContext;
    return { compressor, context, makeup };
}

describe('createSidechainCompressorFallback', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('creates and configures the prepared two-input processor for an offline context', async () => {
        const parameters = new Map(
            ['threshold', 'ratio', 'attack', 'release', 'makeup'].map((name) => [name, { value: 0 } as AudioParam])
        );
        const constructions: Array<{ name: string; options: AudioWorkletNodeOptions }> = [];
        class TestAudioWorkletNode {
            readonly numberOfInputs = 2;
            readonly parameters = parameters;

            constructor(_context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) {
                constructions.push({ name, options });
            }
        }
        vi.stubGlobal('AudioWorkletNode', TestAudioWorkletNode);
        const addModule = vi.fn(() => Promise.resolve());
        const context = { audioWorklet: { addModule }, startRendering: vi.fn() } as unknown as OfflineAudioContext;
        const targetDevice = {};

        await prepareOfflineSidechainCompressor({ offlineCtx: context, targetDevices: new Set([targetDevice]) });
        const deviceNode = createSidechainCompressorFallback(context, targetDevice);
        applySidechainCompressorParams(deviceNode, {
            'sc-comp-threshold': -24,
            'sc-comp-ratio': 6,
            'sc-comp-attack': 12,
            'sc-comp-release': 180,
            'sc-comp-makeup': 3,
        });

        expect(constructions).toEqual([
            {
                name: 'sidechain-compressor-processor',
                options: { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2] },
            },
        ]);
        expect(addModule).toHaveBeenCalledWith('/audio/worklets/sidechain-compressor-processor.js');
        expect(Object.fromEntries([...parameters].map(([name, param]) => [name, param.value]))).toEqual({
            threshold: -24,
            ratio: 6,
            attack: 0.012,
            release: 0.18,
            makeup: 3,
        });
    });

    it('keeps the single-input fallback for an unrelated device target', async () => {
        const { compressor, context, makeup } = makeFallbackContext();
        const otherDevice = {};
        const targetDevice = {};

        await prepareOfflineSidechainCompressor({ offlineCtx: context, targetDevices: new Set([otherDevice]) });
        const deviceNode = createSidechainCompressorFallback(context, targetDevice);

        expect(deviceNode.inputNode).toBe(compressor);
        expect(deviceNode.outputNode).toBe(makeup);
        expect(compressor.knee.value).toBe(30);
    });

    it('uses the single-input fallback when worklet construction fails', async () => {
        const { compressor, context, makeup } = makeFallbackContext();
        const onWarning = vi.fn();
        const targetDevice = {};
        class ThrowingAudioWorkletNode {
            constructor() {
                throw new Error('processor construction failed');
            }
        }
        vi.stubGlobal('AudioWorkletNode', ThrowingAudioWorkletNode);

        await prepareOfflineSidechainCompressor({
            offlineCtx: context,
            onWarning,
            targetDevices: new Set([targetDevice]),
        });
        const deviceNode = createSidechainCompressorFallback(context, targetDevice);

        expect(deviceNode.inputNode).toBe(compressor);
        expect(deviceNode.outputNode).toBe(makeup);
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('processor construction failed'));
    });
});
