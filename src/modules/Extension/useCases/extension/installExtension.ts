import { extensionStore, type ExtensionManifest, type InstalledExtension } from '#/modules/Extension/stores/extension';

export function installExtension(manifest: ExtensionManifest): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    if (state.installed.some((e) => e.manifest.id === manifest.id)) {
        return; // Already installed
    }

    const ext: InstalledExtension = {
        manifest,
        enabled: true,
        installedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        state: {},
    };

    extensionStore.set({
        ...state,
        installed: [...state.installed, ext],
    });
}
