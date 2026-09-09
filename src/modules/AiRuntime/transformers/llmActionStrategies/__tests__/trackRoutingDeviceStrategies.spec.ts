import { describe, expect, it } from 'vitest';

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
