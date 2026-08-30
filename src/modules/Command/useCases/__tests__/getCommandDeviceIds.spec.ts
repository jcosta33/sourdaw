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

/**
 * A restore operand rides in `deviceSnapshot` (`id` / `type`), not
 * `deviceId` / `deviceType`. `expectedDeviceIds` remains a neighbour
 * precondition and must stay out of the operand sweep.
 */
const restoreDevice = {
    trackId: 'track-lead',
    deviceSnapshot: {
        id: 'device-restored',
        type: 'factory-faust-supersaw-pad',
        name: 'Supersaw Pad',
        bypassed: false,
        parameterValues: {},
    },
    deviceIndex: 0,
    expectedDeviceIds: ['device-neighbour'],
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

/**
 * Mirrors production `getDeviceTypesForCommandDeviceIds`: contract identity
 * comes from the snapshot (`externalPluginId ?? type`) because the restored
 * device is already gone from the live track store.
 */
function configureSnapshotOperandResolvers(
    versions: Readonly<Record<string, string | undefined>> = DEVICE_VERSIONS
): void {
    commandDeviceVersionsPort.setDeviceTypeResolver(({ argumentsValue, deviceIds }) => {
        const snapshot = argumentsValue.deviceSnapshot;
        if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
            return {};
        }
        const snapshotId: unknown = Object.getOwnPropertyDescriptor(snapshot, 'id')?.value;
        if (typeof snapshotId !== 'string' || !deviceIds.includes(snapshotId)) {
            return {};
        }
        const externalPluginId: unknown = Object.getOwnPropertyDescriptor(snapshot, 'externalPluginId')?.value;
        const type: unknown = Object.getOwnPropertyDescriptor(snapshot, 'type')?.value;
        if (typeof externalPluginId === 'string' && externalPluginId !== '') {
            return { [snapshotId]: externalPluginId };
        }
        if (typeof type === 'string' && type !== '') {
            return { [snapshotId]: type };
        }
        return {};
    });
    commandDeviceVersionsPort.setResolver((deviceType) => versions[deviceType]);
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

    it('collects the restore snapshot operand id and still omits the neighbour precondition', () => {
        expect(getCommandDeviceIds(restoreDevice)).toEqual(['device-restored']);
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

    it('refuses a restore whose snapshot type has no resolvable version', () => {
        configureSnapshotOperandResolvers({});

        // Discriminating assertion: with an empty operand sweep, capture
        // returned `{}` and deferred re-execution admitted restoring stale
        // parameterValues against a drifted descriptor.
        expect(() =>
            commandDeviceVersionsPort.capture({
                argumentsValue: restoreDevice,
                operation: 'restoreDevice',
            })
        ).toThrow('Device version is unavailable for factory-faust-supersaw-pad');
    });
});
