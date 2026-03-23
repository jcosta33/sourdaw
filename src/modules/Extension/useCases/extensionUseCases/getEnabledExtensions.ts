import { extensionStore, type InstalledExtension } from '#/modules/Extension/stores/extension';

export function getEnabledExtensions(): InstalledExtension[] {
    return (extensionStore.value?.installed ?? []).filter((e) => e.enabled);
}
