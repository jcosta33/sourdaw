import { extensionStore } from '#/modules/Extension/stores/extension';
import { appendLog, createDawApi } from '#/modules/Extension/helpers/scripting';

/**
 * Execute the current editor content in a sandboxed context.
 */
export function runEditorScript(): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    const code = state.editorContent;
    appendLog('info', '▶ Running script...');

    try {
        // Sandboxed execution — create a function scope with limited API
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
