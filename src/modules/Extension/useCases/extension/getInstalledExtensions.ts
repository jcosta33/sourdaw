import { inject } from '#/infra/di/inject';
import { extensionStore, type InstalledExtension } from '#/modules/Extension/stores/extension';

export const getInstalledExtensions = inject({ extensionStore })(({ extensionStore: store }) => {
    return function getInstalledExtensions(): InstalledExtension[] {
        return store.value?.installed ?? [];
    };
});
