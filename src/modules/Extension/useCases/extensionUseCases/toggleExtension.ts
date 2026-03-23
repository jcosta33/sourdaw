import { extensionStore } from '#/modules/Extension/stores/extension';

export function toggleExtension(extensionId: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    extensionStore.set({
        ...state,
        installed: state.installed.map((e) =>
            e.manifest.id === extensionId ? { ...e, enabled: !e.enabled } : e
        ),
    });
}
