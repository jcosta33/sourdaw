import { afterEach, describe, expect, it, vi } from 'vitest';

import { applySidechainCompressorParams } from '../applySidechainCompressorParams';
import { createOfflineSidechainCompressor } from '../createOfflineSidechainCompressor';
import { prepareOfflineSidechainCompressor } from '../prepareOfflineSidechainCompressor';

class TestGainNode {
    readonly gain = { value: 0 };
}

function makeContext(): { context: OfflineAudioContext; makeup: TestGainNode } {
    const makeup = new TestGainNode();
    const addModule = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const context = {
        audioWorklet: { addModule },
        createGain: vi.fn(() => makeup),
    } as unknown as OfflineAudioContext;
    return { context, makeup };
}

describe('createOfflineSidechainCompressor', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('creates and configures the prepared two-input processor for any device, keyed or not', async () => {
        const parameters = new Map(
            ['threshold', 'ratio', 'attack', 'release', 'makeup'].map((name) => [name, { value: 0 } as AudioParam])
        );
        const parameterValues = () =>
            Object.fromEntries(Array.from(parameters, ([name, param]) => [name, param.value]));
        const constructions: Array<{ name: string; options: AudioWorkletNodeOptions }> = [];
        class TestAudioWorkletNode {
            readonly numberOfInputs = 2;
            readonly parameters = parameters;

            constructor(_context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) {
                constructions.push({ name, options });
            }
        }
        vi.stubGlobal('AudioWorkletNode', TestAudioWorkletNode);
        const { context } = makeContext();

        await prepareOfflineSidechainCompressor({ offlineCtx: context });
        const deviceNode = createOfflineSidechainCompressor(context);
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
        expect(parameterValues()).toEqual({
            threshold: -24,
            ratio: 6,
            attack: 0.012,
            release: 0.18,
            makeup: 3,
        });
    });

    it('degrades to a Makeup-only gain when the module was never registered', () => {
        const { context, makeup } = makeContext();

        const deviceNode = createOfflineSidechainCompressor(context);
        applySidechainCompressorParams(deviceNode, { 'sc-comp-threshold': -30, 'sc-comp-makeup': 6 });

        expect(deviceNode.inputNode).toBe(makeup);
        expect(deviceNode.outputNode).toBe(makeup);
        expect(deviceNode.namedNodes?.makeup).toBe(makeup);
        expect(makeup.gain.value).toBeCloseTo(10 ** (6 / 20), 10);
    });

    it('degrades to a Makeup-only gain and warns that ducking is lost when worklet construction fails', async () => {
        const { context, makeup } = makeContext();
        const onWarning = vi.fn();
        class ThrowingAudioWorkletNode {
            constructor() {
                throw new Error('processor construction failed');
            }
        }
        vi.stubGlobal('AudioWorkletNode', ThrowingAudioWorkletNode);

        await prepareOfflineSidechainCompressor({ offlineCtx: context, onWarning });
        const deviceNode = createOfflineSidechainCompressor(context);

        expect(deviceNode.outputNode).toBe(makeup);
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('ducking is lost'));
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('processor construction failed'));
    });

    it('degrades and warns when AudioWorkletNode does not exist', async () => {
        const { context, makeup } = makeContext();
        const onWarning = vi.fn();
        vi.stubGlobal('AudioWorkletNode', undefined);

        await prepareOfflineSidechainCompressor({ offlineCtx: context, onWarning });
        const deviceNode = createOfflineSidechainCompressor(context);

        expect(deviceNode.outputNode).toBe(makeup);
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('AudioWorkletNode is unavailable'));
    });
});
