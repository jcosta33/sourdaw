import { extensionStore } from '../../stores/extension';

import { appendLog } from './appendLog';
import { createDawApi } from './createDawApi';

// SECURITY: this evaluator uses `new Function(code)` which runs the script in
// the global scope. It is NOT sandboxed — the script can access `window`,
// `document`, `fetch`, etc. via globals. Only pass editor content the current
// user authored themselves. Do not execute scripts received from a CRDT sync
// peer, imported projects, or any third-party source without first moving
// evaluation into a Web Worker or iframe with CSP.
export function runEditorScript(): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    const code = state.editorContent;
    appendLog('info', '▶ Running script...');

    try {
        const sandboxedConsole = {
            log: (msg: string) => appendLog('info', String(msg)),
            warn: (msg: string) => appendLog('warn', String(msg)),
            error: (msg: string) => appendLog('error', String(msg)),
        };

        const fn = new Function('console', 'daw', code); // eslint-disable-line @typescript-eslint/no-implied-eval -- intentional: this use case executes user-authored editor scripts; see security note above
        (fn as (console: typeof sandboxedConsole, daw: ReturnType<typeof createDawApi>) => void)(
            sandboxedConsole,
            createDawApi()
        );
        appendLog('info', '✓ Script completed');
    } catch (error) {
        appendLog('error', `Script error: ${error}`);
    }
}
