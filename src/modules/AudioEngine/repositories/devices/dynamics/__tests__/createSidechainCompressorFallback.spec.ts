import { afterEach, describe, expect, it, vi } from 'vitest';

import { applySidechainCompressorParams } from '../applySidechainCompressorParams';
import { createSidechainCompressorFallback } from '../createSidechainCompressorFallback';
import { prepareOfflineSidechainCompressor } from '../prepareOfflineSidechainCompressor';

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

            connect(): AudioNode {
                return this as unknown as AudioNode;
            }

            disconnect(): void {}
        }
        vi.stubGlobal('AudioWorkletNode', TestAudioWorkletNode);
        const addModule = vi.fn(() => Promise.resolve());
        const context = { audioWorklet: { addModule }, startRendering: vi.fn() } as unknown as OfflineAudioContext;

        await prepareOfflineSidechainCompressor(context);
        const deviceNode = createSidechainCompressorFallback(context);
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

    it('keeps the single-input fallback when the worklet was not prepared', () => {
        const compressor = {
            threshold: { value: 0 },
            ratio: { value: 0 },
            attack: { value: 0 },
            release: { value: 0 },
            knee: { value: 0 },
            connect: vi.fn(),
        } as unknown as DynamicsCompressorNode;
        const makeup = { gain: { value: 0 } } as GainNode;
        const context = {
            createDynamicsCompressor: vi.fn(() => compressor),
            createGain: vi.fn(() => makeup),
        } as unknown as BaseAudioContext;

        const deviceNode = createSidechainCompressorFallback(context);

        expect(deviceNode.inputNode).toBe(compressor);
        expect(deviceNode.outputNode).toBe(makeup);
        expect(compressor.knee.value).toBe(30);
    });
});
