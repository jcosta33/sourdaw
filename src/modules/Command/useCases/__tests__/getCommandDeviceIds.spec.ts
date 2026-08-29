import { describe, it, expect, afterEach } from 'vitest';

import { commandDeviceVersionsPort } from '../commandDeviceVersionsPort';
import { getCommandDeviceIds } from '../getCommandDeviceIds';

/**
 * The chain a guarded `addDevice` carries: `deviceId` is the device being
 * written, `expectedDeviceIds` is the compare-and-swap precondition naming the
 * devices already on the track.
 */
const guardedAddDevice = {
    trackId: 'track-lead',
    deviceType: 'grinder',
    deviceId: 'device-new',
    expectedDeviceIds: ['device-supersaw'],
    expectedFrozen: false,
};

/** The one device already on the track, whose type resolves to no descriptor. */
const CHAIN_DEVICE_TYPES: Readonly<Record<string, string>> = {
    'device-supersaw': 'factory-faust-supersaw-pad',
};

const DEVICE_VERSIONS: Readonly<Record<string, string>> = {
    grinder: 'descriptor-v1:grinder',
};

function configureResolvers(): void {
    commandDeviceVersionsPort.setDeviceTypeResolver(({ deviceIds }) =>
        Object.fromEntries(
            deviceIds.flatMap((deviceId) => {
                const deviceType = CHAIN_DEVICE_TYPES[deviceId];
                return deviceType === undefined ? [] : [[deviceId, deviceType]];
            })
        )
    );
    commandDeviceVersionsPort.setResolver((deviceType) => DEVICE_VERSIONS[deviceType]);
}

afterEach(() => {
    commandDeviceVersionsPort.setDeviceTypeResolver(null);
    commandDeviceVersionsPort.setResolver(null);
});

describe('getCommandDeviceIds', () => {
    it('omits the compare-and-swap precondition while collecting the devices the command operates on', () => {
        expect(getCommandDeviceIds(guardedAddDevice)).toEqual(['device-new']);
    });

    it('still collects every operand id shape', () => {
        expect(
            getCommandDeviceIds({
                deviceId: 'device-a',
                afterDeviceId: 'device-b',
                removableReverbDeviceIds: ['device-c'],
                nested: { targetDeviceId: 'device-d' },
            })
        ).toEqual(['device-a', 'device-b', 'device-c', 'device-d']);
    });
});

describe('commandDeviceVersionsPort.capture', () => {
    it('admits a guarded add whose precondition names a device with no resolvable version', () => {
        configureResolvers();

        // Discriminating assertion: while `expectedDeviceIds` counted as an
        // operand, this threw `Device version is unavailable for
        // factory-faust-supersaw-pad` and the add was refused outright, even
        // though the command never reads or writes that neighbour.
        expect(commandDeviceVersionsPort.capture({ argumentsValue: guardedAddDevice, operation: 'addDevice' })).toEqual(
            { grinder: 'descriptor-v1:grinder' }
        );
    });

    it('still refuses a command that operates on a device with no resolvable version', () => {
        configureResolvers();

        expect(() =>
            commandDeviceVersionsPort.capture({
                argumentsValue: { trackId: 'track-lead', deviceId: 'device-supersaw', parameterId: 'gain', value: 0.5 },
                operation: 'setDeviceParameter',
            })
        ).toThrow('Device version is unavailable for factory-faust-supersaw-pad');
    });
});
