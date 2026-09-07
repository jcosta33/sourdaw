import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { resolveBatchLocalBindingProducer } from '../batchLocalBindingProducers';

const projectContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

const filterParameter = {
    id: 'filter-type',
    name: 'Type',
    type: 'choice' as const,
    value: 0,
    minValue: 0,
    maxValue: 3,
    unit: '',
    choices: ['Lowpass', 'Highpass', 'Bandpass', 'Notch'],
};

describe('resolveBatchLocalBindingProducer', () => {
    it('declares a producer for each track kind an addTrack plan item may carry', () => {
        const kinds = ['audio', 'midi', 'folder'];

        const producers = kinds.map((kind) =>
            resolveBatchLocalBindingProducer({
                arguments: { kind, name: 'Aux' },
                context: projectContext,
                name: 'addTrack',
                producersByBinding: new Map(),
            })
        );

        expect(producers.map((producer) => producer?.trackKind)).toEqual(kinds);
    });

    it('refuses an inherited object key as a track kind', () => {
        const producer = resolveBatchLocalBindingProducer({
            arguments: { kind: 'toString', name: 'Aux' },
            context: projectContext,
            name: 'addTrack',
            producersByBinding: new Map(),
        });

        expect(producer).toBeNull();
    });

    it('resolves a bound device from the canonical descriptor on an admitted created track', () => {
        const producer = resolveBatchLocalBindingProducer({
            arguments: { trackId: '$lead', deviceType: 'Filter' },
            context: {
                ...projectContext,
                availableDeviceTypes: [{ id: 'builtin-filter', name: 'Filter', parameters: [filterParameter] }],
            },
            name: 'addDevice',
            producersByBinding: new Map([
                [
                    'lead',
                    {
                        capabilities: ['track', 'device-host-track'],
                        producerArgument: 'id',
                        trackKind: 'midi' as const,
                    },
                ],
            ]),
        });

        expect(producer).toEqual({
            capabilities: ['device'],
            createdDeviceName: 'Filter',
            createdDeviceParameters: [filterParameter],
            createdDeviceType: 'builtin-filter',
            parentTrackReference: '$lead',
            producerArgument: 'deviceId',
        });
    });

    it('refuses missing descriptors, frozen parents, and anchors owned by another track', () => {
        const context: ProjectContext = {
            ...projectContext,
            availableDeviceTypes: [{ id: 'builtin-filter', name: 'Filter', parameters: [filterParameter] }],
            tracks: [
                {
                    id: 'track-frozen',
                    name: 'Frozen',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    frozen: true,
                    gain: 1,
                    pan: 0,
                    automationMode: 'read',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
                {
                    id: 'track-other',
                    name: 'Other',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 1,
                    pan: 0,
                    automationMode: 'read',
                    clipCount: 0,
                    deviceCount: 1,
                    clips: [],
                    devices: [{ id: 'device-other', type: 'builtin-filter', bypassed: false }],
                    sends: [],
                },
                {
                    id: 'track-host',
                    name: 'Host',
                    kind: 'midi',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 1,
                    pan: 0,
                    automationMode: 'read',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
            ],
        };
        const resolve = (argumentsRecord: Record<string, unknown>) =>
            resolveBatchLocalBindingProducer({
                arguments: argumentsRecord,
                context,
                name: 'addDevice',
                producersByBinding: new Map(),
            });

        expect(resolve({ trackId: 'track-frozen', deviceType: 'Filter' })).toBeNull();
        expect(resolve({ trackId: 'track-other', deviceType: 'Missing' })).toBeNull();
        expect(
            resolveBatchLocalBindingProducer({
                arguments: { trackId: 'track-host', deviceType: 'Filter' },
                context: { ...context, availableDeviceTypes: [{ id: 'builtin-filter', name: 'Filter' }] },
                name: 'addDevice',
                producersByBinding: new Map(),
            })
        ).toBeNull();
        expect(resolve({ trackId: 'track-host', deviceType: 'Filter', afterDeviceId: 'device-other' })).toBeNull();
    });
});
