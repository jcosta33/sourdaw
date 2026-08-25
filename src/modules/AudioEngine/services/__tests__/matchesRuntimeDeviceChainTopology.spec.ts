import { describe, expect, it } from 'vitest';

import { asAudioNode, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';

import { matchesRuntimeDeviceChainTopology } from '../matchesRuntimeDeviceChainTopology';

import type { BuiltinDeviceNode, TrackChannelStrip } from '../../models/AudioEngineState';
import type { RuntimeGraphDeltaDevice, RuntimeGraphDeltaNode } from '../../models/RuntimeGraphDelta';

type RuntimeDeviceFixture = Readonly<{
    id: string;
    type: string;
    externalInstanceId?: string;
    parameterIds: readonly string[];
}>;

type LiveDeviceFixture = Readonly<{
    deviceId: string;
    type: string;
    externalInstanceId?: string;
    parameterIds?: readonly string[];
}>;

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

function createStereoPannerNode(): StereoPannerNode {
    const node = asAudioNode(createMockAudioNode('stereo-panner'));
    if (!isStereoPannerNode(node)) {
        throw new Error('Expected the stereo-panner fixture to expose pan.');
    }
    return node;
}

function createAnalyserNode(): AnalyserNode {
    const node = asAudioNode(createMockAudioNode('analyser'));
    if (!isAnalyserNode(node)) {
        throw new Error('Expected the analyser-node fixture to expose fftSize.');
    }
    return node;
}

function createLiveDevice({ deviceId, type, externalInstanceId, parameterIds }: LiveDeviceFixture): BuiltinDeviceNode {
    const inputNode = asAudioNode(createMockAudioNode('gain'));
    const outputNode = asAudioNode(createMockAudioNode('gain'));
    return {
        deviceId,
        type,
        ...(externalInstanceId === undefined ? {} : { externalInstanceId }),
        ...(parameterIds === undefined ? {} : { parameterIds }),
        nodes: [inputNode, outputNode],
        inputNode,
        outputNode,
    };
}

function createTrackStrip(
    trackId = 'track-1',
    devices: readonly LiveDeviceFixture[] = [
        { deviceId: 'eq-1', type: 'equalizer', parameterIds: ['frequency', 'gain'] },
        { deviceId: 'compressor-1', type: 'compressor', parameterIds: ['attack', 'ratio'] },
    ]
): TrackChannelStrip {
    return {
        trackId,
        preFaderTap: createGainNode(),
        gainNode: createGainNode(),
        faderNode: createGainNode(),
        postFaderGain: createGainNode(),
        panNode: createStereoPannerNode(),
        meterNode: null,
        analyserNode: createAnalyserNode(),
        muted: false,
        soloGated: false,
        soloed: false,
        deviceNodes: devices.map(createLiveDevice),
        midiFxNodes: [],
        meterBuffer: new Float32Array(128),
    };
}

function createExpectedDevice({
    id,
    type,
    externalInstanceId,
    parameterIds,
}: RuntimeDeviceFixture): RuntimeGraphDeltaDevice {
    return {
        id,
        type,
        ...(externalInstanceId === undefined ? {} : { externalInstanceId }),
        parameterIds,
    };
}

function createExpectedTopology(
    id = 'track-1',
    devices: readonly RuntimeDeviceFixture[] = [
        { id: 'eq-1', type: 'equalizer', parameterIds: ['frequency', 'gain'] },
        { id: 'compressor-1', type: 'compressor', parameterIds: ['attack', 'ratio'] },
    ]
): RuntimeGraphDeltaNode {
    return { id, kind: 'audio', devices: devices.map(createExpectedDevice) };
}

describe('matchesRuntimeDeviceChainTopology', () => {
    it('returns true for an exact track and ordered device topology', () => {
        expect(matchesRuntimeDeviceChainTopology(createTrackStrip(), createExpectedTopology())).toBe(true);
    });

    it('returns false when the runtime strip is undefined', () => {
        expect(matchesRuntimeDeviceChainTopology(undefined, createExpectedTopology())).toBe(false);
    });

    it('returns false when the track ids differ', () => {
        expect(matchesRuntimeDeviceChainTopology(createTrackStrip('track-2'), createExpectedTopology())).toBe(false);
    });

    it('returns false when the device counts differ', () => {
        expect(
            matchesRuntimeDeviceChainTopology(
                createTrackStrip(),
                createExpectedTopology('track-1', [
                    { id: 'eq-1', type: 'equalizer', parameterIds: ['frequency', 'gain'] },
                ])
            )
        ).toBe(false);
    });

    it('returns false when devices are in a different order', () => {
        expect(
            matchesRuntimeDeviceChainTopology(
                createTrackStrip(),
                createExpectedTopology('track-1', [
                    { id: 'compressor-1', type: 'compressor', parameterIds: ['attack', 'ratio'] },
                    { id: 'eq-1', type: 'equalizer', parameterIds: ['frequency', 'gain'] },
                ])
            )
        ).toBe(false);
    });

    it('returns false when a device id differs', () => {
        expect(
            matchesRuntimeDeviceChainTopology(
                createTrackStrip(),
                createExpectedTopology('track-1', [
                    { id: 'eq-other', type: 'equalizer', parameterIds: ['frequency', 'gain'] },
                    { id: 'compressor-1', type: 'compressor', parameterIds: ['attack', 'ratio'] },
                ])
            )
        ).toBe(false);
    });

    it('returns false when a device type differs', () => {
        expect(
            matchesRuntimeDeviceChainTopology(
                createTrackStrip(),
                createExpectedTopology('track-1', [
                    { id: 'eq-1', type: 'filter', parameterIds: ['frequency', 'gain'] },
                    { id: 'compressor-1', type: 'compressor', parameterIds: ['attack', 'ratio'] },
                ])
            )
        ).toBe(false);
    });

    it('returns false when an external instance id differs', () => {
        const strip = createTrackStrip('track-1', [
            {
                deviceId: 'external-1',
                type: 'native-plugin',
                externalInstanceId: 'instance-live',
                parameterIds: ['mix'],
            },
        ]);
        const expected = createExpectedTopology('track-1', [
            {
                id: 'external-1',
                type: 'native-plugin',
                externalInstanceId: 'instance-expected',
                parameterIds: ['mix'],
            },
        ]);

        expect(matchesRuntimeDeviceChainTopology(strip, expected)).toBe(false);
    });

    it('normalizes missing runtime parameter ids only to an empty list', () => {
        const strip = createTrackStrip('track-1', [{ deviceId: 'eq-1', type: 'equalizer' }]);

        expect(
            matchesRuntimeDeviceChainTopology(
                strip,
                createExpectedTopology('track-1', [{ id: 'eq-1', type: 'equalizer', parameterIds: [] }])
            )
        ).toBe(true);
        expect(
            matchesRuntimeDeviceChainTopology(
                strip,
                createExpectedTopology('track-1', [{ id: 'eq-1', type: 'equalizer', parameterIds: ['frequency'] }])
            )
        ).toBe(false);
    });

    it('returns false when a parameter schema has a different count', () => {
        expect(
            matchesRuntimeDeviceChainTopology(
                createTrackStrip('track-1', [
                    { deviceId: 'eq-1', type: 'equalizer', parameterIds: ['frequency', 'gain'] },
                ]),
                createExpectedTopology('track-1', [{ id: 'eq-1', type: 'equalizer', parameterIds: ['frequency'] }])
            )
        ).toBe(false);
    });

    it('returns false when equal-count parameter ids have a different order', () => {
        expect(
            matchesRuntimeDeviceChainTopology(
                createTrackStrip('track-1', [
                    { deviceId: 'eq-1', type: 'equalizer', parameterIds: ['frequency', 'gain'] },
                ]),
                createExpectedTopology('track-1', [
                    { id: 'eq-1', type: 'equalizer', parameterIds: ['gain', 'frequency'] },
                ])
            )
        ).toBe(false);
    });

    it('returns false when equal-count parameter ids have different content', () => {
        expect(
            matchesRuntimeDeviceChainTopology(
                createTrackStrip('track-1', [
                    { deviceId: 'eq-1', type: 'equalizer', parameterIds: ['frequency', 'gain'] },
                ]),
                createExpectedTopology('track-1', [{ id: 'eq-1', type: 'equalizer', parameterIds: ['frequency', 'q'] }])
            )
        ).toBe(false);
    });
});
