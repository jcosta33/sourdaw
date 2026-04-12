import { extensionStore } from '../../stores/extension';

export function uninstallExtension(extensionId: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    extensionStore.set({
        ...state,
        installed: state.installed.filter((e) => e.manifest.id !== extensionId),
        commands: state.commands.filter((c) => c.extensionId !== extensionId),
    });
}
