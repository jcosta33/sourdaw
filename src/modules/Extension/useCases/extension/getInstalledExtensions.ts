import { extensionStore, type InstalledExtension } from '../../stores/extension';

export function getInstalledExtensions(): InstalledExtension[] {
    return extensionStore.value?.installed ?? [];
}
