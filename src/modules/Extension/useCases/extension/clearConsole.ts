import { extensionStore } from '#/modules/Extension/stores/extension';

export function clearConsole(): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }
    extensionStore.set({ ...state, consoleLog: [] });
}
