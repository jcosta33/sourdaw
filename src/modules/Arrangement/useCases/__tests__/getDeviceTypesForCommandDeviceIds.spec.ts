import { afterEach, describe, expect, it } from 'vitest';

import { trackStore } from '../../stores/trackStore';
import { createTrack } from '../createTrack';
import { getDeviceTypesForCommandDeviceIds } from '../getDeviceTypesForCommandDeviceIds';

describe('getDeviceTypesForCommandDeviceIds', () => {
    afterEach(() => {
        trackStore.set(null);
    });

    it('resolves existing devices and the application-owned MIDI default', () => {
        const existing = createTrack({
            id: 'track-existing',
            initialAlternativeId: 'alternative-existing',
            initialDeviceId: 'device-existing',
            kind: 'midi',
            name: 'Keys',
        });
        trackStore.set({ selectedTrackId: null, tracks: [existing] });

        expect(
            getDeviceTypesForCommandDeviceIds({
                argumentsValue: { deviceId: 'device-existing' },
                deviceIds: ['device-existing'],
                operation: 'setDeviceParameter',
            })
        ).toEqual({ 'device-existing': 'builtin-synth' });
        expect(
            getDeviceTypesForCommandDeviceIds({
                argumentsValue: {
                    initialDeviceId: 'device-new',
                    kind: 'midi',
                },
                deviceIds: ['device-new'],
                operation: 'addTrack',
            })
        ).toEqual({ 'device-new': 'builtin-synth' });
    });
});
