import { resolveSidechainInput, type SidechainTargetCapability } from '../../models/SidechainInputByDeviceType';

export type { SidechainTargetCapability };

/** The key input a sidechain route drives on a device, or null when the device takes no sidechain key. */
export function getSidechainTargetCapability(deviceType: string): SidechainTargetCapability | null {
    return resolveSidechainInput(deviceType);
}
