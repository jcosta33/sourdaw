import { extensionStore } from '../../stores/extension';

export function clearConsole(): void {
    if (!extensionStore.value) {
        return;
    }

    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return { ...state, consoleLog: [] };
    });
}
