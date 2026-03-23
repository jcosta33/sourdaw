/**
 * Extension scripting helpers — shared console logging and sandboxed API creation.
 */

import { extensionStore } from '#/modules/Extension/stores/extension';
import { notifyUser } from '#/helpers/Notification/notifyUser';

/**
 * Append a log entry to the extension console (keeps last 100 entries).
 */
export function appendLog(level: 'info' | 'warn' | 'error', message: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }
    extensionStore.set({
        ...state,
        consoleLog: [
            ...state.consoleLog.slice(-99), // Keep last 100 entries
            { timestamp: new Date().toISOString(), level, message },
        ],
    });
}

/**
 * Create a sandboxed DAW API object for script execution.
 *
 * Note: dynamic import is intentional here — the scripting sandbox cannot
 * hold direct references to internal modules. Notifications use the
 * centralised `notifyUser` helper.
 */
export function createDawApi(): Record<string, unknown> {
    return {
        version: '0.1.0',
        notify: (message: string) => {
            notifyUser(message);
        },
        executeAction: async (action: { type: string; payload?: unknown }) => {
            const { executeAppAction } = await import('#/modules/Command/useCases/executeAppAction');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await executeAppAction(action as any, { source: 'ai' });
        },
    };
}
