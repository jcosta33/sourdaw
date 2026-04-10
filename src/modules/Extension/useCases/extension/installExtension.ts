import { inject } from '#/infra/di/inject';
import { extensionStore, type ExtensionManifest, type InstalledExtension } from '#/modules/Extension/stores/extension';

export const installExtension = inject({ extensionStore })(({ extensionStore: store }) => {
    return function installExtension(manifest: ExtensionManifest): void {
        const state = store.value;
        if (!state) {
            return;
        }

        if (state.installed.some((e) => e.manifest.id === manifest.id)) {
            return;
        }

        const ext: InstalledExtension = {
            manifest,
            enabled: true,
            installedAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
            state: {},
        };

        store.set({
            ...state,
            installed: [...state.installed, ext],
        });
    };
});
