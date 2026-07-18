import { closePluginGui as closePluginGuiRepo } from '../../repositories/pluginBridge/closePluginGui';

/** Close a plugin's GUI window. */
export function closePluginGui(instanceId: string): ReturnType<typeof closePluginGuiRepo> {
    return closePluginGuiRepo(instanceId);
}
