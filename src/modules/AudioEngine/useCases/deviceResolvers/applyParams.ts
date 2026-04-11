import { applyParams as applyParamsImpl, type OfflineDeviceNode } from '../../repositories/deviceNodeFactory';

export function applyParams(dn: OfflineDeviceNode, deviceType: string, params: Record<string, number>): void {
    applyParamsImpl(dn, deviceType, params);
}