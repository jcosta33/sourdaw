import { describe, expect, it } from 'vitest';

import { type CreativeRequestAuthority } from '../../../models/CreativeInterpretation';
import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

const RADIO_PROMPT = 'make it sound like a radio';

/** Names a direction for the gain and no figure for it, which is what the creative route decides. */
const QUIETER_RADIO_PROMPT = 'make the Guitar quieter and more distant, like an old radio';

const guitarTrack: ProjectContextTrack = {
    id: 'guitar',
    name: 'Guitar',
    kind: 'audio',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    clipCount: 1,
    deviceCount: 1,
    clips: [{ id: 'guitar-clip-1', name: 'Guitar Take', type: 'audio', startBeat: 0, endBeat: 16, noteCount: 0 }],
    devices: [
        {
            id: 'guitar-eq-1',
            type: 'eq',
            bypassed: false,
            parameters: [
                { id: 'gain', name: 'Gain', type: 'float', value: 0, minValue: -12, maxValue: 12, unit: 'dB' },
            ],
        },
    ],
};

const bassTrack: ProjectContextTrack = {
    id: 'bass',
    name: 'Bass',
    kind: 'audio',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    clipCount: 0,
    deviceCount: 0,
    clips: [],
    devices: [],
};

const context: ProjectContext = {
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
    availableDeviceTypes: [
        { id: 'radio-filter', name: 'Radio Filter' },
        { id: 'compressor', name: 'Compressor' },
    ],
    tracks: [guitarTrack, bassTrack],
    selectedTrackId: 'guitar',
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

/**
 * Two published device types share one display name, so a provider naming that name matches several
 * and the creative acceptance defers to the ordinary rule that refuses it.
 */
const ambiguousDeviceTypeContext: ProjectContext = {
    ...context,
    availableDeviceTypes: [
        { id: 'radio-filter', name: 'Radio Filter' },
        { id: 'radio-filter-vintage', name: 'Radio Filter' },
    ],
};

function buildAuthority(overrides: Partial<CreativeRequestAuthority> = {}): CreativeRequestAuthority {
    return {
        schemaVersion: 1,
        authorityId: 'creative-authority-1',
        catalogId: 'creative-catalog-1',
        requestDigest: 'request-digest-1',
        revision: 'revision-1',
        selection: { trackId: 'guitar', clipId: null, clipIds: [], activeView: 'arrange' },
        mode: 'edit',
        targets: [
            {
                provenance: 'contextual-selection',
                objectType: 'track',
                objectIds: ['guitar'],
                parentTrackId: null,
            },
        ],
        editDimensions: ['processing'],
        prohibitions: [],
        creationSlots: [{ objectType: 'device', parentObjectId: 'guitar', budget: 4 }],
        uncertainty: 'none',
        ...overrides,
    };
}

function bridge(input: {
    calls: readonly ToolCallResult[];
    creativeAuthority?: CreativeRequestAuthority;
    projectContext?: ProjectContext;
    prompt?: string;
}) {
    return bridgeGroundedLlmToolCalls({
        calls: input.calls,
        context: input.projectContext ?? context,
        prompt: input.prompt ?? RADIO_PROMPT,
        ...(input.creativeAuthority === undefined ? {} : { creativeAuthority: input.creativeAuthority }),
    });
}

const addRadioFilter: ToolCallResult = {
    name: 'addDevice',
    arguments: { trackId: 'guitar', deviceType: 'radio-filter' },
};

describe('creative authority grounding in the tool-call bridge', () => {
    it('refuses a device the request never named when the run carries no authority', () => {
        const result = bridge({ calls: [addRadioFilter] });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'addDevice', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('grounds the same device once the admitted authority covers the track and the dimension', () => {
        const result = bridge({ calls: [addRadioFilter], creativeAuthority: buildAuthority() });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([
            { type: 'addDevice', payload: { trackId: 'guitar', deviceType: 'radio-filter' } },
        ]);
    });

    it('refuses the same device when the request withdrew the change it described', () => {
        const result = bridge({
            calls: [addRadioFilter],
            creativeAuthority: buildAuthority(),
            prompt: "add something that makes the Guitar sound like a radio, but don't apply the change",
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'addDevice', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('refuses a gain that contradicts the direction the request stated without a number', () => {
        const result = bridge({
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'guitar', gain: 1 } }],
            creativeAuthority: buildAuthority(),
            prompt: QUIETER_RADIO_PROMPT,
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'setTrackGain', reason: 'Provider value gain does not match the user request' },
        ]);
    });

    it('grounds a gain the request left open in the direction it stated', () => {
        const result = bridge({
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'guitar', gain: 0.5 } }],
            creativeAuthority: buildAuthority(),
            prompt: QUIETER_RADIO_PROMPT,
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([{ type: 'setTrackGain', payload: { trackId: 'guitar', gain: 0.5 } }]);
    });

    it('grounds a parameter value the request never stated', () => {
        const result = bridge({
            calls: [{ name: 'setDeviceParameter', arguments: { deviceId: 'guitar-eq-1', paramId: 'gain', value: 4 } }],
            creativeAuthority: buildAuthority(),
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([
            { type: 'setDeviceParameter', payload: { deviceId: 'guitar-eq-1', paramId: 'gain', value: 4 } },
        ]);
    });

    it('grounds a bypass intent the request never phrased', () => {
        const result = bridge({
            calls: [{ name: 'bypassDevice', arguments: { deviceId: 'guitar-eq-1', bypassed: true } }],
            creativeAuthority: buildAuthority(),
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([
            { type: 'bypassDevice', payload: { deviceId: 'guitar-eq-1', bypassed: true } },
        ]);
    });

    it('still refuses a value that contradicts a number the request stated', () => {
        const result = bridge({
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'guitar', gain: 0.3 } }],
            creativeAuthority: buildAuthority(),
            prompt: `${RADIO_PROMPT} at 0.5`,
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'setTrackGain', reason: 'Provider value gain does not match the user request' },
        ]);
    });

    it('grounds the value the request stated', () => {
        const result = bridge({
            calls: [{ name: 'setTrackGain', arguments: { trackId: 'guitar', gain: 0.5 } }],
            creativeAuthority: buildAuthority(),
            prompt: `${RADIO_PROMPT} at 0.5`,
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toMatchObject([{ type: 'setTrackGain', payload: { trackId: 'guitar', gain: 0.5 } }]);
    });

    it('refuses a device type that matches several published types', () => {
        const result = bridge({
            calls: [{ name: 'addDevice', arguments: { trackId: 'guitar', deviceType: 'Radio Filter' } }],
            creativeAuthority: buildAuthority(),
            projectContext: ambiguousDeviceTypeContext,
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'addDevice', reason: 'Provider value deviceType does not match the user request' },
        ]);
    });

    it('refuses a call on a track the admitted authority does not name', () => {
        const result = bridge({
            calls: [addRadioFilter],
            creativeAuthority: buildAuthority({
                targets: [
                    {
                        provenance: 'contextual-selection',
                        objectType: 'track',
                        objectIds: ['bass'],
                        parentTrackId: null,
                    },
                ],
                creationSlots: [{ objectType: 'device', parentObjectId: 'bass', budget: 4 }],
            }),
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections[0]?.reason).toMatch(/^Creative authority /u);
    });
});
