export async function createFaustDeviceNode(ctx: BaseAudioContext, pluginId: string) {
    const { createFaustDevice } = await import('../../repositories/faustDeviceFactory');
    return createFaustDevice(ctx, pluginId);
}
