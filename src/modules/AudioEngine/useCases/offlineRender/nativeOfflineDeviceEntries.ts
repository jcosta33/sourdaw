import { type Track } from '#/modules/Arrangement/stores';

import { nativeBuiltinBody } from '../livePlayback/nativeBuiltinBodies';

import { classifyNativeOfflineHostedDevice, type NativeOfflineHostedRuntime } from './nativeOfflineHostedDevice';
import { type StripAutomationDeviceEntry } from './projectStripAutomationWrites';

/**
 * The devices on this strip the native render prints and stamps, in chain
 * order: the built-ins it builds a body for and the hosted plugins, effects and
 * instruments, it builds an offline instance of, admitted by the selection's own predicate.
 */
export function nativeOfflineDeviceEntries(
    track: Track,
    hostedRuntime: NativeOfflineHostedRuntime
): readonly StripAutomationDeviceEntry[] {
    return track.devices.flatMap((device): StripAutomationDeviceEntry[] => {
        const hosted = classifyNativeOfflineHostedDevice(device, hostedRuntime);
        if (device.externalInstanceId !== undefined && (hosted === 'effect' || hosted === 'instrument')) {
            return [{ deviceId: device.id, deviceType: device.type, externalInstanceId: device.externalInstanceId }];
        }
        return nativeBuiltinBody(device.type) === null ? [] : [{ deviceId: device.id, deviceType: device.type }];
    });
}
