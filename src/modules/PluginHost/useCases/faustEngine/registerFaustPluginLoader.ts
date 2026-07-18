import { registerPluginLoader } from '../../services/pluginLoaderRegistry';

import { compileFaustDSP } from './compileFaustDSP';
import { createFaustNode } from './createFaustNode';

export function registerFaustPluginLoader(): void {
    registerPluginLoader('faust.', async (pluginId, context) => {
        const faustModuleId = pluginId.replace('faust.', '');
        const compiled = await compileFaustDSP(faustModuleId);
        if (!compiled) {
            return null;
        }
        return createFaustNode(faustModuleId, context);
    });
}

registerFaustPluginLoader();
