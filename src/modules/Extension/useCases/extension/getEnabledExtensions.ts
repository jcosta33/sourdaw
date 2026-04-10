import { inject } from '#/infra/di/inject';
import { extensionStore, type InstalledExtension } from '#/modules/Extension/stores/extension';

export const getEnabledExtensions = inject({ extensionStore })(({ extensionStore: store }) => {
    return function getEnabledExtensions(): InstalledExtension[] {
        return (store.value?.installed ?? []).filter((e) => e.enabled);
    };
});
