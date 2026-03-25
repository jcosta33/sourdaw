import { extensionStore } from '#/modules/Extension/stores/extension';
import { appendLog } from '#/modules/Extension/services/scripting';

export function executeCommand(commandId: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    const cmd = state.commands.find((c) => c.id === commandId);
    if (!cmd) {
        appendLog('error', `Command not found: ${commandId}`);
        return;
    }

    try {
        const result = cmd.handler();
        if (result instanceof Promise) {
            result.catch((err) => appendLog('error', `Command error: ${err}`));
        }
    } catch (err) {
        appendLog('error', `Command error: ${err}`);
    }
}
