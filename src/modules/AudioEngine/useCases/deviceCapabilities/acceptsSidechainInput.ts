import { resolveSidechainInput } from '../../models/SidechainInputByDeviceType';

/** True for a device with a second input that a sidechain route keys (the sidechain compressor). */
export function acceptsSidechainInput(deviceType: string): boolean {
    return resolveSidechainInput(deviceType) !== null;
}
