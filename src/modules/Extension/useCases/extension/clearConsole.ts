import { extensionStore } from '../../stores/extension';

export function clearConsole(): void {
    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return { ...state, consoleLog: [] };
    });
}
