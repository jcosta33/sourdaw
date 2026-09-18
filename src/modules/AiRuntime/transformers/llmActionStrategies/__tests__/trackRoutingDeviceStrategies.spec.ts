import { describe, expect, it } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeDeviceToolCall, deviceActionNames, deviceStrategyRegistry } from '../deviceStrategy';
import { bridgeRoutingToolCall, routingActionNames, routingStrategyRegistry } from '../routingStrategy';
import { bridgeTrackToolCall, trackActionNames, trackStrategyRegistry } from '../trackStrategy';

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
    punchOutBeat: 0,
    metronomeEnabled: false,
    metronomeVolume: 0,
    masterGain: 1,
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
    tracks: [
        {
            id: 'track-vox',
            name: 'Vox',
            kind: 'audio',
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
        },
    ],
};

const foreignCall = { name: 'addMarker', arguments: { beat: 0, name: 'Intro' } };

describe('trackStrategy', () => {
    it('registers exactly the exported track action names', () => {
        expect(new Set(trackStrategyRegistry.keys())).toEqual(new Set(trackActionNames));
    });

    it('returns null for a name owned by another family', () => {
        expect(bridgeTrackToolCall({ call: foreignCall, context: projectContext, index: 0 })).toBeNull();
    });

    it('reproduces the addTrack rejection reason for an unsupported kind', () => {
        expect(
            bridgeTrackToolCall({
                call: { name: 'addTrack', arguments: { name: 'New Bus', kind: 'bus' } },
                context: projectContext,
                index: 2,
            })
        ).toEqual({
            index: 2,
            name: 'addTrack',
            reason: 'Expected a safe name and one of audio, midi, or folder',
        });
    });
});

describe('routingStrategy', () => {
    it('registers exactly the exported routing action names', () => {
        expect(new Set(routingStrategyRegistry.keys())).toEqual(new Set(routingActionNames));
    });

    it('returns null for a name owned by another family', () => {
        expect(
            bridgeRoutingToolCall({
                call: foreignCall,
                context: projectContext,
                index: 0,
                sidechainRouteDeviceAdmissions: [],
            })
        ).toBeNull();
    });

    it('reproduces the createBus rejection reason for an empty name', () => {
        expect(
            bridgeRoutingToolCall({
                call: { name: 'createBus', arguments: { name: '' } },
                context: projectContext,
                index: 4,
                sidechainRouteDeviceAdmissions: [],
            })
        ).toEqual({
            index: 4,
            name: 'createBus',
            reason: 'Expected only a non-empty bus name no longer than 120 characters without framing or control characters',
        });
    });
});

describe('deviceStrategy', () => {
    it('registers exactly the exported device action names', () => {
        expect(new Set(deviceStrategyRegistry.keys())).toEqual(new Set(deviceActionNames));
    });

    it('returns null for a name owned by another family', () => {
        expect(
            bridgeDeviceToolCall({ call: foreignCall, context: projectContext, index: 0, sectionSignatures: [] })
        ).toBeNull();
    });

    it('reproduces the removeDevice rejection reason for a missing deviceId', () => {
        expect(
            bridgeDeviceToolCall({
                call: { name: 'removeDevice', arguments: { deviceId: 'missing-device' } },
                context: projectContext,
                index: 6,
                sectionSignatures: [],
            })
        ).toEqual({
            index: 6,
            name: 'removeDevice',
            reason: 'Expected one existing deviceId',
        });
    });
});

// ── Untested-guard pins (issue #4110) ───────────────────────────────────
//
// Each case crosses exactly one guard: the rejected input differs from an
// accepted twin only in the guarded property, and the exact rejection text the
// branch emits is asserted. Weakening or removing any guard turns its twin
// green and leaves the rejecting case red.

const guardContext: ProjectContext = {
    ...projectContext,
    availableDeviceTypes: [{ id: 'builtin-eq', name: 'EQ' }],
    tracks: [
        {
            ...projectContext.tracks[0]!,
            id: 'track-vox',
            name: 'Vox',
            sends: [{ busId: 'bus-drums', level: 0.5, preFader: false }],
            devices: [
                {
                    id: 'device-vox-eq',
                    name: 'Vox EQ',
                    type: 'builtin-eq',
                    bypassed: false,
                    parameters: [
                        { id: 'mix', name: 'Mix', type: 'float', value: 0.5, minValue: 0, maxValue: 1, unit: '%' },
                    ],
                },
            ],
        },
        { ...projectContext.tracks[0]!, id: 'bus-drums', name: 'Drum Bus', kind: 'bus' },
        { ...projectContext.tracks[0]!, id: 'bus-empty', name: 'Empty Bus', kind: 'bus' },
        { ...projectContext.tracks[0]!, id: 'master', name: 'Master', kind: 'master' },
        {
            ...projectContext.tracks[0]!,
            id: 'track-gtr',
            name: 'Guitar',
            devices: [
                { id: 'device-gtr-comp', name: 'Compressor', type: 'builtin-sidechain-compressor', bypassed: false },
            ],
        },
        {
            ...projectContext.tracks[0]!,
            id: 'track-frozen',
            name: 'Frozen Print',
            frozen: true,
            devices: [
                {
                    id: 'device-frozen-eq',
                    name: 'Frozen EQ',
                    type: 'builtin-eq',
                    bypassed: false,
                    parameters: [
                        { id: 'mix', name: 'Mix', type: 'float', value: 0.5, minValue: 0, maxValue: 1, unit: '%' },
                    ],
                },
            ],
        },
    ],
};

const bridgeCall = (name: string, args: Record<string, unknown>, index = 0): unknown => {
    const track = bridgeTrackToolCall({ call: { name, arguments: args }, context: guardContext, index });
    if (track !== null) {
        return track;
    }
    const routing = bridgeRoutingToolCall({
        call: { name, arguments: args },
        context: guardContext,
        index,
        sidechainRouteDeviceAdmissions: [],
    });
    if (routing !== null) {
        return routing;
    }
    return bridgeDeviceToolCall({
        call: { name, arguments: args },
        context: guardContext,
        index,
        sectionSignatures: [],
    });
};

describe('track, routing, and device strategy guards (issue #4110)', () => {
    const expectAccepted = (name: string, args: Record<string, unknown>, expected: unknown) => {
        expect(bridgeCall(name, args)).toEqual(expected);
    };

    const expectRejected = (name: string, args: Record<string, unknown>, reason: string, index = 0) => {
        expect(bridgeCall(name, args, index)).toEqual({ index, name, reason });
    };

    it('setTrackGain rejects a negative gain while accepting the zero lower bound', () => {
        expectAccepted(
            'setTrackGain',
            { trackId: 'track-vox', gain: 0 },
            {
                type: 'setTrackGain',
                payload: { trackId: 'track-vox', gain: 0 },
            }
        );
        expectRejected(
            'setTrackGain',
            { trackId: 'track-vox', gain: -0.01 },
            `Expected an available trackId and finite gain from 0 through ${String(FADER_MAX_GAIN)}`
        );
    });

    it('setTrackPan rejects an above-50 pan while accepting the 50 upper bound', () => {
        expectAccepted(
            'setTrackPan',
            { trackId: 'track-vox', pan: 50 },
            {
                type: 'setTrackPan',
                payload: { trackId: 'track-vox', pan: 50 },
            }
        );
        expectRejected(
            'setTrackPan',
            { trackId: 'track-vox', pan: 51 },
            'Expected an available trackId and finite pan from -50 through 50'
        );
    });

    it('renameTrack rejects unexpected keys while accepting the exact-argument rename of an existing track', () => {
        expectAccepted(
            'renameTrack',
            { trackId: 'track-vox', name: 'Voice' },
            {
                type: 'renameTrack',
                payload: { trackId: 'track-vox', name: 'Voice' },
            }
        );
        expectRejected(
            'renameTrack',
            { trackId: 'track-vox', name: 'Voice', select: true },
            'Expected an available trackId and name'
        );
    });

    it('setSend rejects unexpected keys while accepting the exact-argument send update', () => {
        expectAccepted(
            'setSend',
            { trackId: 'track-vox', busId: 'bus-drums', level: 0.25 },
            {
                type: 'setSend',
                payload: {
                    trackId: 'track-vox',
                    busId: 'bus-drums',
                    level: 0.25,
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            }
        );
        expectRejected(
            'setSend',
            { trackId: 'track-vox', busId: 'bus-drums', level: 0.25, preFader: true },
            'Expected an available source track, distinct bus track, and finite level from 0 through 1'
        );
    });

    it('setSend rejects a level above 1 while accepting the 1 upper bound', () => {
        expectAccepted(
            'setSend',
            { trackId: 'track-vox', busId: 'bus-drums', level: 1 },
            {
                type: 'setSend',
                payload: {
                    trackId: 'track-vox',
                    busId: 'bus-drums',
                    level: 1,
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            }
        );
        expectRejected(
            'setSend',
            { trackId: 'track-vox', busId: 'bus-drums', level: 1.01 },
            'Expected an available source track, distinct bus track, and finite level from 0 through 1'
        );
    });

    it('addSend treats a master target as non-bus while accepting a distinct bus', () => {
        expectAccepted(
            'addSend',
            { trackId: 'track-vox', busId: 'bus-empty', level: 0.5 },
            {
                type: 'addSend',
                payload: { trackId: 'track-vox', busId: 'bus-empty', level: 0.5, expectedAbsent: true },
            }
        );
        expectRejected(
            'addSend',
            { trackId: 'track-vox', busId: 'master', level: 0.5 },
            'Expected an available source, a distinct bus without an existing send, and a finite level from 0 through 1'
        );
    });

    it('addSidechainRoute rejects a self route while accepting two distinct routable tracks', () => {
        expectAccepted(
            'addSidechainRoute',
            { sourceTrackId: 'track-vox', targetTrackId: 'track-gtr' },
            {
                type: 'addSidechainRoute',
                // The track's single supported sidechain device is auto-selected;
                // the payload omits the id when the provider named none.
                payload: { sourceTrackId: 'track-vox', targetTrackId: 'track-gtr' },
            }
        );
        expectRejected(
            'addSidechainRoute',
            { sourceTrackId: 'track-vox', targetTrackId: 'track-vox' },
            'Expected two distinct routable source and target tracks'
        );
    });

    it('addDevice rejects unexpected keys while accepting the exact-argument device add', () => {
        expectAccepted(
            'addDevice',
            { trackId: 'track-vox', deviceType: 'builtin-eq' },
            {
                type: 'addDevice',
                payload: { trackId: 'track-vox', deviceType: 'builtin-eq' },
            }
        );
        expectRejected(
            'addDevice',
            { trackId: 'track-vox', deviceType: 'builtin-eq', afterDeviceId: 'device-nope' },
            'Expected a non-frozen device-capable track, one platform-available built-in device type, and an optional anchor device on that track'
        );
    });

    it('addDevice rejects a frozen track while accepting the same call on a thawed track', () => {
        expectRejected(
            'addDevice',
            { trackId: 'track-frozen', deviceType: 'builtin-eq' },
            'Expected a non-frozen device-capable track, one platform-available built-in device type, and an optional anchor device on that track'
        );
    });

    it('removeDevice rejects unexpected keys while accepting the exact-argument removal', () => {
        expectAccepted(
            'removeDevice',
            { deviceId: 'device-vox-eq' },
            {
                type: 'removeDevice',
                payload: { deviceId: 'device-vox-eq' },
            }
        );
        expectRejected('removeDevice', { deviceId: 'device-vox-eq', force: true }, 'Expected one existing deviceId');
    });

    it('setDeviceParameter rejects unexpected keys while accepting the exact-argument parameter set', () => {
        expectAccepted(
            'setDeviceParameter',
            { deviceId: 'device-vox-eq', paramId: 'mix', value: 0.3 },
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: 'device-vox-eq',
                    paramId: 'mix',
                    value: 0.3,
                    expectedTrackId: 'track-vox',
                    expectedDeviceType: 'builtin-eq',
                    expectedDeviceIds: ['device-vox-eq'],
                    expectedValue: 0.5,
                    expectedTrackFrozen: false,
                },
            }
        );
        expectRejected(
            'setDeviceParameter',
            { deviceId: 'device-vox-eq', paramId: 'mix', value: 0.3, ramp: false },
            'Expected an available device parameter and finite value'
        );
    });

    it('setDeviceParameter rejects a frozen-track device while accepting the same call on a thawed track', () => {
        expectRejected(
            'setDeviceParameter',
            { deviceId: 'device-frozen-eq', paramId: 'mix', value: 0.3 },
            'Expected a descriptor-backed parameter value within project bounds'
        );
    });

    it('bypassDevice rejects unexpected keys while accepting the exact-argument bypass', () => {
        expectAccepted(
            'bypassDevice',
            { deviceId: 'device-vox-eq', bypassed: true },
            {
                type: 'bypassDevice',
                payload: { deviceId: 'device-vox-eq', bypassed: true },
            }
        );
        expectRejected(
            'bypassDevice',
            { deviceId: 'device-vox-eq', bypassed: true, momentary: false },
            'Expected an available deviceId and boolean bypassed value'
        );
    });
});
