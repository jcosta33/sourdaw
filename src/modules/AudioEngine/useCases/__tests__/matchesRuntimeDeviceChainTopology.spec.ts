import { describe, it, expect, vi } from 'vitest';

import { asAudioNode, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { matchesRuntimeDeviceChainTopology } from '../matchesRuntimeDeviceChainTopology';

import type { AudioEngine, BuiltinDeviceNode, TrackChannelStrip } from '../../models/AudioEngineState';
import type { RuntimeGraphDeltaNode } from '../../models/RuntimeGraphDelta';

function isGainNode(node: AudioNode): node is GainNode {
    return 'gain' in node;
}

function isStereoPannerNode(node: AudioNode): node is StereoPannerNode {
    return 'pan' in node;
}

function isAnalyserNode(node: AudioNode): node is AnalyserNode {
    return 'fftSize' in node;
}

function createGainNode(): GainNode {
    const node = asAudioNode(createMockAudioNode('gain'));
    if (!isGainNode(node)) {
        throw new Error('Expected the gain-node fixture to expose gain.');
    }
    return node;
}

function createStrip(trackId: string, deviceNodes: BuiltinDeviceNode[]): TrackChannelStrip {
    const panNode = asAudioNode(createMockAudioNode('stereo-panner'));
    const analyserNode = asAudioNode(createMockAudioNode('analyser'));
    if (!isStereoPannerNode(panNode) || !isAnalyserNode(analyserNode)) {
        throw new Error('Expected the strip node fixtures to expose pan and fftSize.');
    }
    return {
        trackId,
        preFaderTap: createGainNode(),
        gainNode: createGainNode(),
        faderNode: createGainNode(),
        postFaderGain: createGainNode(),
        panNode,
        meterNode: null,
        analyserNode,
        carrierGate: createGainNode(),
        preFaderSendGate: createGainNode(),
        muted: false,
        nativeCarried: false,
        soloGated: false,
        soloed: false,
        deviceNodes,
        midiFxNodes: [],
        meterBuffer: new Float32Array(128),
    };
}

function createDeviceNode(deviceId: string, type: string, parameterIds: readonly string[]): BuiltinDeviceNode {
    const node = createGainNode();
    return { deviceId, type, parameterIds, nodes: [node], inputNode: node, outputNode: node };
}

function createEngineWithStrips(strips: readonly TrackChannelStrip[]) {
    const engineGetTrackStrip = vi.fn<AudioEngine['getTrackStrip']>((trackId) =>
        strips.find((strip) => strip.trackId === trackId)
    );
    const engine: Pick<AudioEngine, 'getTrackStrip'> = { getTrackStrip: engineGetTrackStrip };
    return { engine, engineGetTrackStrip };
}

const expected: RuntimeGraphDeltaNode = { id: 'track-1', kind: 'audio', devices: [] };

describe('matchesRuntimeDeviceChainTopology', () => {
    it('should match when the strip the engine returns for the id has the expected topology', () => {
        const engineGetTrackStrip = vi.fn<AudioEngine['getTrackStrip']>(() => createStrip('track-1', []));
        const engine: Pick<AudioEngine, 'getTrackStrip'> = { getTrackStrip: engineGetTrackStrip };
        const run = injectDependencies(matchesRuntimeDeviceChainTopology, { audioEngine: engine });

        expect(run(expected)).toBe(true);
        expect(engineGetTrackStrip).toHaveBeenCalledTimes(1);
        expect(engineGetTrackStrip).toHaveBeenCalledWith('track-1');
    });

    it('should not match when the engine has no strip for the id', () => {
        const engine: Pick<AudioEngine, 'getTrackStrip'> = {
            getTrackStrip: vi.fn<AudioEngine['getTrackStrip']>(() => undefined),
        };
        const run = injectDependencies(matchesRuntimeDeviceChainTopology, { audioEngine: engine });

        expect(run(expected)).toBe(false);
    });

    it('should read the strip of the expected node id and compare its device chain', () => {
        const expectedWithDevice: RuntimeGraphDeltaNode = {
            id: 'track-7',
            kind: 'audio',
            devices: [{ id: 'device-a', type: 'reverb', parameterIds: ['mix', 'size'] }],
        };
        const matching = createStrip('track-7', [createDeviceNode('device-a', 'reverb', ['mix', 'size'])]);
        const differing = createStrip('track-7', [createDeviceNode('device-b', 'reverb', ['mix', 'size'])]);
        const other = createStrip('track-1', []);

        const matched = createEngineWithStrips([other, matching]);
        const runMatched = injectDependencies(matchesRuntimeDeviceChainTopology, { audioEngine: matched.engine });
        expect(runMatched(expectedWithDevice)).toBe(true);
        expect(matched.engineGetTrackStrip).toHaveBeenCalledTimes(1);
        expect(matched.engineGetTrackStrip).toHaveBeenCalledWith('track-7');

        const mismatched = createEngineWithStrips([other, differing]);
        const runMismatched = injectDependencies(matchesRuntimeDeviceChainTopology, {
            audioEngine: mismatched.engine,
        });
        expect(runMismatched(expectedWithDevice)).toBe(false);
        expect(mismatched.engineGetTrackStrip).toHaveBeenCalledWith('track-7');
    });
});
