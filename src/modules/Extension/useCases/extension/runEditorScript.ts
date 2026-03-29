import { extensionStore } from '#/modules/Extension/stores/extension';
import { appendLog, createDawApi } from '#/modules/Extension/services/scripting';

// TODO: SECURITY — This is NOT sandboxed. `new Function()` runs in the main
// renderer context with full access to window, document, fetch, localStorage,
// and the entire application state via createDawApi().executeAction.
// Before re-exposing this to users:
//   1. Move execution to a dedicated Worker with postMessage-based API
//   2. Proxy createDawApi calls through the Worker boundary with validation
//   3. Enforce ExtensionManifest.permissions at each API call site
//   4. Add CSP headers to prevent dynamic script injection
// See .agents/audits/dead-code-audit.md Section 10 for full analysis.

/**
 * Execute the current editor content.
 * WARNING: Uses unsandboxed new Function() — do not expose to user-supplied code.
 */
export function runEditorScript(): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    const code = state.editorContent;
    appendLog('info', '▶ Running script...');

    try {
        // WARNING: NOT sandboxed — new Function runs in main context
        const sandboxedConsole = {
            log: (msg: string) => appendLog('info', String(msg)),
            warn: (msg: string) => appendLog('warn', String(msg)),
            error: (msg: string) => appendLog('error', String(msg)),
        };

        const fn = new Function('console', 'daw', code);
        fn(sandboxedConsole, createDawApi());
        appendLog('info', '✓ Script completed');
    } catch (err) {
        appendLog('error', `Script error: ${err}`);
    }
}
