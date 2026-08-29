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

    it('resolves a restore snapshot operand that is already gone from the track store', () => {
        const host = createTrack({
            id: 'track-host',
            initialAlternativeId: 'alternative-host',
            kind: 'audio',
            name: 'Host',
        });
        trackStore.set({ selectedTrackId: null, tracks: [host] });

        expect(
            getDeviceTypesForCommandDeviceIds({
                argumentsValue: {
                    deviceIndex: 0,
                    deviceSnapshot: {
                        bypassed: false,
                        id: 'device-restored',
                        name: 'Supersaw Pad',
                        parameterValues: {},
                        type: 'factory-faust-supersaw-pad',
                    },
                    expectedDeviceIds: ['device-neighbour'],
                    trackId: 'track-host',
                },
                deviceIds: ['device-restored'],
                operation: 'restoreDevice',
            })
        ).toEqual({ 'device-restored': 'factory-faust-supersaw-pad' });
        expect(
            getDeviceTypesForCommandDeviceIds({
                argumentsValue: {
                    deviceIndex: 0,
                    deviceSnapshot: {
                        bypassed: false,
                        externalPluginId: 'com.vendor.plugin',
                        id: 'device-restored-external',
                        name: 'Vendor Plugin',
                        parameterValues: {},
                        type: 'external-plugin',
                    },
                    trackId: 'track-host',
                },
                deviceIds: ['device-restored-external'],
                operation: 'restoreDevice',
            })
        ).toEqual({ 'device-restored-external': 'com.vendor.plugin' });
    });
});
