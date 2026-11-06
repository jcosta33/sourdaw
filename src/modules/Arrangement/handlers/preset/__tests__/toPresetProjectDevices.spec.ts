import { describe, expect, it } from 'vitest';

import { type DeviceSnapshot } from '#/utils/handlerContract';

import { toPresetProjectDevices } from '../toPresetProjectDevices';

const hostedSnapshot: DeviceSnapshot = {
    id: 'hosted-device',
    name: 'Hosted Synth',
    type: 'external-plugin',
    bypassed: true,
    parameterValues: { cutoff: 0.25 },
    externalPluginId: 'clap:com.example.synth',
    externalInstanceId: 'instance-7',
    externalStateChunk: 'c3RhdGU=',
    deviceState: { version: 2, data: { mode: 'poly', steps: [1, 0, 1] } },
};

const builtInSnapshot: DeviceSnapshot = {
    id: 'built-in-device',
    name: 'Poly',
    type: 'builtin-synth',
    bypassed: false,
    parameterValues: { cutoff: 0.6 },
};

describe('toPresetProjectDevices', () => {
    it('keeps every optional identity and state key a snapshot carries, cloning its mutable values', () => {
        const [device] = toPresetProjectDevices([hostedSnapshot]);

        expect(device).toEqual({
            id: 'hosted-device',
            name: 'Hosted Synth',
            type: 'external-plugin',
            bypassed: true,
            parameterValues: { cutoff: 0.25 },
            externalPluginId: 'clap:com.example.synth',
            externalInstanceId: 'instance-7',
            externalStateChunk: 'c3RhdGU=',
            deviceState: { version: 2, data: { mode: 'poly', steps: [1, 0, 1] } },
        });
        expect(device?.deviceState).not.toBe(hostedSnapshot.deviceState);
        expect(device?.deviceState?.data).not.toBe(hostedSnapshot.deviceState?.data);
        expect(device?.parameterValues).not.toBe(hostedSnapshot.parameterValues);
    });

    it('adds no optional key a snapshot does not carry', () => {
        const [device] = toPresetProjectDevices([builtInSnapshot]);

        expect(device).toEqual({
            id: 'built-in-device',
            name: 'Poly',
            type: 'builtin-synth',
            bypassed: false,
            parameterValues: { cutoff: 0.6 },
        });
        expect(Object.keys(device ?? {})).toEqual(['id', 'name', 'type', 'bypassed', 'parameterValues']);
        expect(device !== undefined && 'deviceState' in device).toBe(false);
    });
});
