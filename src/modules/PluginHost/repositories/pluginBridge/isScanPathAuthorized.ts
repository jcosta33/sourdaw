import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

/**
 * Whether the native scan policy would authorize `path` as a scan root.
 *
 * The same verdict `scan_plugins` enforces, asked before a path is saved so
 * settings can only hold folders a scan can honor. Outside the desktop app
 * there is no policy to ask and nothing is authorizable.
 */
export async function isScanPathAuthorized(path: string): Promise<boolean> {
    if (!isDesktopRuntime()) {
        return false;
    }
    return desktopInvoke('is_scan_path_authorized', { path }) as Promise<boolean>;
}
