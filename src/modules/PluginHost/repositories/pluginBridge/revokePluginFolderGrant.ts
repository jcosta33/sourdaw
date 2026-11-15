import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

/** Withdraw one plugin folder grant. Outside the desktop app there is nothing to withdraw. */
export async function revokePluginFolderGrant(path: string): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('revoke_plugin_folder_grant', { path });
}
