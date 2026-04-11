import { extensionStore, type InstalledExtension } from '#/modules/Extension/stores/extension';

export function getInstalledExtensions(): InstalledExtension[] {
    return extensionStore.value?.installed ?? [];
}
