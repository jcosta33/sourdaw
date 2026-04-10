import { inject } from '#/infra/di/inject';
import { extensionStore } from '#/modules/Extension/stores/extension';

export const toggleExtension = inject({ extensionStore })(({ extensionStore: store }) => {
    return function toggleExtension(extensionId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }

        store.set({
            ...state,
            installed: state.installed.map((e) => (e.manifest.id === extensionId ? { ...e, enabled: !e.enabled } : e)),
        });
    };
});
