import { describe, it, expect, vi } from 'vitest';

import { asAudioNode, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { matchesRuntimeDeviceChainTopology } from '../matchesRuntimeDeviceChainTopology';

import type { AudioEngine, TrackChannelStrip } from '../../models/AudioEngineState';
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

function createStripWithoutDevices(trackId: string): TrackChannelStrip {
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
        deviceNodes: [],
        midiFxNodes: [],
        meterBuffer: new Float32Array(128),
    };
}

const expected: RuntimeGraphDeltaNode = { id: 'track-1', kind: 'audio', devices: [] };

describe('matchesRuntimeDeviceChainTopology', () => {
    it('should match when the strip the engine returns for the id has the expected topology', () => {
        const engineGetTrackStrip = vi.fn<AudioEngine['getTrackStrip']>(() => createStripWithoutDevices('track-1'));
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
});
