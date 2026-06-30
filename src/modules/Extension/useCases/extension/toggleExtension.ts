import { extensionStore } from '../../stores/extension';

export function toggleExtension(extensionId: string): void {
    if (!extensionStore.value) {
        return;
    }

    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return {
            ...state,
            installed: state.installed.map((extension) =>
                extension.manifest.id === extensionId ? { ...extension, enabled: !extension.enabled } : extension
            ),
        };
    });
}
