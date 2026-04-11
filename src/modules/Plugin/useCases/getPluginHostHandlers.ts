import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';
import { handleLoadExternalPlugin } from '../handlers/pluginHost/handleLoadExternalPlugin';
import { handleScanPlugins } from '../handlers/pluginHost/handleScanPlugins';

type PluginHostAppAction =
    | Extract<AppAction, { type: 'scanPlugins' }>
    | Extract<AppAction, { type: 'loadExternalPlugin' }>;

export type PluginHostHandlersMap = {
    [Action in PluginHostAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges plugin-host `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getPluginHostHandlers(): PluginHostHandlersMap {
    return {
        scanPlugins: handleScanPlugins,
        loadExternalPlugin: handleLoadExternalPlugin,
    };
}
