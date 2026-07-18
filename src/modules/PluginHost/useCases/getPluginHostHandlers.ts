import { handleScanPlugins } from '../handlers/pluginHost/handleScanPlugins';

export type PluginHostHandlersMap = {
    scanPlugins: typeof handleScanPlugins;
};

/**
 * Merges plugin-host `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getPluginHostHandlers(): PluginHostHandlersMap {
    return {
        scanPlugins: handleScanPlugins,
    };
}
