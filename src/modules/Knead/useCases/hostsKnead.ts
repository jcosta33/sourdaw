import { resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';

/** Whether a track's device chain contains Knead, matched the way the native factory matches it. */
export function hostsKnead(devices: readonly { type: string }[]): boolean {
    return devices.some((device) => resolveBuiltinDeviceType(device.type) === 'knead');
}
