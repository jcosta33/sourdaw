import { extensionStore, type InstalledExtension } from '../../stores/extension';

export function getEnabledExtensions(): InstalledExtension[] {
    return (extensionStore.value?.installed ?? []).filter((e) => e.enabled);
}
