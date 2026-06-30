import { extensionStore } from '../../stores/extension';

export function uninstallExtension(extensionId: string): void {
    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return {
            ...state,
            installed: state.installed.filter((extension) => extension.manifest.id !== extensionId),
            commands: state.commands.filter((command) => command.extensionId !== extensionId),
        };
    });
}
