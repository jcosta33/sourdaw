import { inject } from '#/infra/di/inject';
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
export const runEditorScript = inject({ extensionStore, appendLog, createDawApi })(
    ({ extensionStore: store, appendLog: log, createDawApi: dawApi }) => {
        return function runEditorScript(): void {
            const state = store.value;
            if (!state) {
                return;
            }

            const code = state.editorContent;
            log('info', '▶ Running script...');

            try {
                const sandboxedConsole = {
                    log: (msg: string) => log('info', String(msg)),
                    warn: (msg: string) => log('warn', String(msg)),
                    error: (msg: string) => log('error', String(msg)),
                };

                const fn = new Function('console', 'daw', code);
                fn(sandboxedConsole, dawApi());
                log('info', '✓ Script completed');
            } catch (err) {
                log('error', `Script error: ${err}`);
            }
        };
    }
);
