import { openPluginGui as openPluginGuiRepo } from '../../repositories/pluginBridge/openPluginGui';

/** Open a plugin's GUI window. */
export function openPluginGui(instanceId: string): ReturnType<typeof openPluginGuiRepo> {
    return openPluginGuiRepo(instanceId);
}