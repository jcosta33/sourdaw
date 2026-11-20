import { isBuiltinSynthDevice as isBuiltinSynthDeviceType } from '../../models/noteInputKindByDeviceType';

/** True for the built-in synthesizer family, voiced by the note scheduler rather than a chain node. */
export function isBuiltinSynthDevice(deviceType: string): boolean {
    return isBuiltinSynthDeviceType(deviceType);
}
