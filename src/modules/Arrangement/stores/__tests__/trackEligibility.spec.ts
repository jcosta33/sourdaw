import { describe, expect, expectTypeOf, it } from 'vitest';

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
    it('accepts only current production kinds plus dormant VCA at the public type boundary', () => {
        expectTypeOf<Parameters<typeof getTrackEligibility>[0]>().toEqualTypeOf<
            'audio' | 'midi' | 'bus' | 'master' | 'folder' | 'vca'
        >();
    });

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
    ] as const)('preserves the frozen %s row', (kind, expected) => {
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

    it('denies an unexpected runtime kind instead of making it audio eligible', () => {
        const eligibility: unknown = Reflect.apply(getTrackEligibility, undefined, ['future-track-kind']);

        expect(eligibility).toEqual(getTrackEligibility('vca'));
    });
});
