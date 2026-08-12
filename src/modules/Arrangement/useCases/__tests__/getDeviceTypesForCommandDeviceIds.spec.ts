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
        const external = createTrack({
            id: 'track-external',
            initialAlternativeId: 'alternative-external',
            kind: 'audio',
            name: 'External',
        });
        external.devices = [
            {
                bypassed: false,
                externalPluginId: 'com.vendor.plugin',
                id: 'device-external',
                name: 'Vendor Plugin',
                parameterValues: {},
                type: 'external-plugin',
            },
        ];
        trackStore.set({ selectedTrackId: null, tracks: [existing, external] });

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
        expect(
            getDeviceTypesForCommandDeviceIds({
                argumentsValue: { deviceId: 'device-external' },
                deviceIds: ['device-external'],
                operation: 'setExternalPluginState',
            })
        ).toEqual({ 'device-external': 'com.vendor.plugin' });
    });
});
