import { pluginScanStore, defaultPluginScanState } from '../../../stores/pluginScanStore';

export function getState() {
    return pluginScanStore.value ?? defaultPluginScanState;
}

/** Whether `path` is `folder` itself or lies inside it, on either separator. */
export function isWithinFolder(path: string, folder: string): boolean {
    if (path === folder) {
        return true;
    }
    if (folder.endsWith('/') || folder.endsWith('\\')) {
        return path.startsWith(folder);
    }
    return path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`);
}
