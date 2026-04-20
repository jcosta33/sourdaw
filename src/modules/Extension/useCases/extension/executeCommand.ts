import { appendLog } from '../../services/scripting';
import { extensionStore } from '../../stores/extension';

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
            result.catch((error) => appendLog('error', `Command error: ${error}`));
        }
    } catch (error) {
        appendLog('error', `Command error: ${error}`);
    }
}
