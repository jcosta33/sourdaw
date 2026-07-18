import { compileFaustDSP, createFaustNode } from '#/modules/PluginHost/useCases';

import { createFaustDevice } from '../../repositories/faustDeviceFactory';

export async function createFaustDeviceNode(ctx: BaseAudioContext, pluginId: string) {
    return createFaustDevice({
        ctx,
        faustModuleId: pluginId,
        compileFaustDSP,
        createFaustNode,
    });
}
