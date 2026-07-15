import { extensionStore } from '../../stores/extension';

export function appendLog(level: 'info' | 'warn' | 'error', message: string): void {
    if (!extensionStore.value) {
        return;
    }

    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return {
            ...state,
            consoleLog: [
                ...state.consoleLog.slice(-99), // Keep last 100 entries
                { timestamp: new Date().toISOString(), level, message },
            ],
        };
    });
}
