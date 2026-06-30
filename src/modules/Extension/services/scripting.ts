/**
 * Extension scripting helpers — console logging and API creation.
 *
 * TODO: SECURITY — createDawApi() exposes executeAppAction with full access to
 * the entire action registry (tracks, clips, transport, plugins, AI, etc.).
 * The `action as AppAction` cast forwards arbitrary action shapes to the
 * registry without validation. Permissions declared in
 * ExtensionManifest are never checked. Before shipping:
 *   1. Move to Worker-based execution with postMessage proxy
 *   2. Validate each action against the extension's declared permissions
 *   3. Rate-limit API calls from scripts
 */

import { executeAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { extensionStore } from '../stores/extension';

/**
 * Append a log entry to the extension console (keeps last 100 entries).
 */
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

/**
 * Create a DAW API object for script execution.
 * WARNING: This is NOT sandboxed — scripts get full executeAppAction access.
 */
export function createDawApi(): Record<string, unknown> {
    return {
        version: '0.1.0',
        notify: (message: string) => {
            notifyUser(message);
        },
        executeAction: async (action: { type: string; payload?: unknown }) => {
            type AppAction = Parameters<typeof executeAppAction>[0];
            await executeAppAction(action as AppAction, { source: 'ai' });
        },
    };
}
