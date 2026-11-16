import { getPluginFolderGrants } from '../../../repositories/pluginBridge/getPluginFolderGrants';
import { pluginScanStore } from '../../../stores/pluginScanStore';

import { getState } from './helpers';

export type RefreshPluginFolderGrantsOutcome = { refreshed: true } | { refreshed: false; reason: string };

function failureDetail(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Mirror the native plugin-folder grants into the scan store.
 *
 * The native grant store is the authority; this only copies what it reports,
 * so the settings view lists exactly the folders a scan will consider. A
 * failed query leaves the previous list in place and says why.
 */
export async function refreshPluginFolderGrants(): Promise<RefreshPluginFolderGrantsOutcome> {
    try {
        const grants = await getPluginFolderGrants();
        pluginScanStore.set({
            ...getState(),
            grantedFolders: grants.map((grant) => ({ path: grant.path, unavailableReason: grant.unavailable_reason })),
        });
        return { refreshed: true };
    } catch (error) {
        return { refreshed: false, reason: `Could not read the added plugin folders: ${failureDetail(error)}` };
    }
}
