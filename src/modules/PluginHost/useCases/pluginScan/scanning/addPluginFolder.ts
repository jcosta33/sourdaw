import { addPluginFolder as requestPluginFolderGrant } from '../../../repositories/pluginBridge/addPluginFolder';

import { refreshPluginFolderGrants } from './refreshPluginFolderGrants';

export type AddPluginFolderOutcome =
    { added: true; path: string } | { added: false; reason: string } | { added: false; cancelled: true };

/**
 * Let the user pick a folder to scan for plugins, and grant it.
 *
 * The desktop shell owns the picker and the grant, so the renderer never
 * names the path. A refusal carries the native policy's own reason. A grant
 * refreshes the listed folders, since the native side may have canonicalized
 * the path the user picked.
 */
export async function addPluginFolder(): Promise<AddPluginFolderOutcome> {
    let result: Awaited<ReturnType<typeof requestPluginFolderGrant>>;
    try {
        result = await requestPluginFolderGrant();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { added: false, reason: `Could not add a plugin folder: ${detail}` };
    }
    if (result.status === 'cancelled') {
        return { added: false, cancelled: true };
    }
    if (result.status === 'refused') {
        return { added: false, reason: result.reason };
    }
    const refresh = await refreshPluginFolderGrants();
    if (!refresh.refreshed) {
        return { added: false, reason: `Added ${result.path}, but ${refresh.reason}` };
    }
    return { added: true, path: result.path };
}
