import { inject } from '#/infra/di/inject';
import { extensionStore } from '#/modules/Extension/stores/extension';

export const clearConsole = inject({ extensionStore })(({ extensionStore: store }) => {
    return function clearConsole(): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, consoleLog: [] });
    };
});
