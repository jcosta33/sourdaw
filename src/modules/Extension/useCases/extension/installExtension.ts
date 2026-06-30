import { extensionStore, type ExtensionManifest, type InstalledExtension } from '../../stores/extension';

export function installExtension(manifest: ExtensionManifest): void {
    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        if (state.installed.some((extension) => extension.manifest.id === manifest.id)) {
            return state;
        }

        const installedExtension: InstalledExtension = {
            manifest,
            enabled: true,
            installedAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
            state: {},
        };

        return {
            ...state,
            installed: [...state.installed, installedExtension],
        };
    });
}
