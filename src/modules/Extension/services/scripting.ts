/**
 * Extension scripting helpers — console logging and API creation.
 *
 * TODO: SECURITY — createDawApi() exposes executeAppAction with full access to
 * the entire action registry (tracks, clips, transport, plugins, AI, etc.).
 * The `as any` cast bypasses type safety. Permissions declared in
 * ExtensionManifest are never checked. Before shipping:
 *   1. Move to Worker-based execution with postMessage proxy
 *   2. Validate each action against the extension's declared permissions
 *   3. Rate-limit API calls from scripts
 * See `.agents/audits/webdaw-codebase-audit.md` → **Findings → Extension scripting (frozen)**.
 */

import { extensionStore } from '#/modules/Extension/stores/extension';
import { notifyUser } from '#/utils/Notification/notifyUser';

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
            const { executeAppAction } = await import('#/modules/Command/useCases');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await executeAppAction(action as any, { source: 'ai' });
        },
    };
}
