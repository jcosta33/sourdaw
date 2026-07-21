import { describe, expect, it } from 'vitest';

import { getTrackEligibility } from '../trackEligibility';

const ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES = {
    acceptsClipAdd: true,
    acceptsClipUpdate: true,
    acceptsArm: true,
    acceptsRecording: true,
    acceptsDeviceAdd: true,
    acceptsDeviceUpdate: true,
    acceptsMidiFxAdd: true,
    acceptsMidiFxUpdate: true,
    acceptsInput: true,
    acceptsMonitoring: true,
    acceptsSend: true,
    acceptsOutput: true,
    acceptsRoutingEndpoint: true,
    acceptsFreeze: true,
    acceptsBounce: true,
} as const;

describe('getTrackEligibility', () => {
    it.each([
        [
            'audio',
            {
                ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
                removesMidiFxProjectResidue: false,
                rendersTrackContent: true,
                createsLiveStrip: true,
                createsOfflineStrip: true,
                exportsStem: true,
            },
        ],
        [
            'midi',
            {
                ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
                removesMidiFxProjectResidue: true,
                rendersTrackContent: true,
                createsLiveStrip: true,
                createsOfflineStrip: true,
                exportsStem: true,
            },
        ],
        [
            'bus',
            {
                ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
                removesMidiFxProjectResidue: false,
                rendersTrackContent: false,
                createsLiveStrip: true,
                createsOfflineStrip: true,
                exportsStem: true,
            },
        ],
        [
            'master',
            {
                ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
                removesMidiFxProjectResidue: false,
                rendersTrackContent: false,
                createsLiveStrip: true,
                createsOfflineStrip: true,
                exportsStem: false,
            },
        ],
        [
            'folder',
            {
                ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
                removesMidiFxProjectResidue: false,
                rendersTrackContent: false,
                createsLiveStrip: false,
                createsOfflineStrip: false,
                exportsStem: false,
            },
        ],
    ])('preserves the frozen %s row', (kind, expected) => {
        expect(getTrackEligibility(kind)).toEqual(expected);
    });

    it('denies dormant VCA audio-bearing writes and allocation while retaining MIDI FX residue cleanup', () => {
        expect(getTrackEligibility('vca')).toEqual({
            acceptsClipAdd: false,
            acceptsClipUpdate: false,
            acceptsArm: false,
            acceptsRecording: false,
            acceptsDeviceAdd: false,
            acceptsDeviceUpdate: false,
            acceptsMidiFxAdd: false,
            acceptsMidiFxUpdate: false,
            removesMidiFxProjectResidue: true,
            acceptsInput: false,
            acceptsMonitoring: false,
            acceptsSend: false,
            acceptsOutput: false,
            acceptsRoutingEndpoint: false,
            acceptsFreeze: false,
            acceptsBounce: false,
            rendersTrackContent: false,
            createsLiveStrip: false,
            createsOfflineStrip: false,
            exportsStem: false,
        });
    });
});
