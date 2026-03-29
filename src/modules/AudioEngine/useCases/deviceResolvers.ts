import { DEVICE_FACTORIES as factories, applyParams as apply } from '../repositories/deviceNodeFactory';

export const DEVICE_FACTORIES = factories;
export const applyParams = apply;

export async function createFaustDeviceNode(ctx: BaseAudioContext, pluginId: string) {
    const { createFaustDevice } = await import('../repositories/faustDeviceFactory');
    return createFaustDevice(ctx, pluginId);
}
