import {
    DEVICE_FACTORIES,
    applyParams as applyParamsImpl,
    type OfflineDeviceNode,
} from '../repositories/deviceNodeFactory';

export { DEVICE_FACTORIES };

export function applyParams(dn: OfflineDeviceNode, deviceType: string, params: Record<string, number>): void {
    applyParamsImpl(dn, deviceType, params);
}

export async function createFaustDeviceNode(ctx: BaseAudioContext, pluginId: string) {
    const { createFaustDevice } = await import('../repositories/faustDeviceFactory');
    return createFaustDevice(ctx, pluginId);
}
