import { inject } from '#/infra/di/inject';
import { extensionStore } from '#/modules/Extension/stores/extension';

export const uninstallExtension = inject({ extensionStore })(({ extensionStore: store }) => {
    return function uninstallExtension(extensionId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }

        store.set({
            ...state,
            installed: state.installed.filter((e) => e.manifest.id !== extensionId),
            commands: state.commands.filter((c) => c.extensionId !== extensionId),
        });
    };
});
