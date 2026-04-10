import { inject } from '#/infra/di/inject';
import { extensionStore } from '#/modules/Extension/stores/extension';
import { appendLog } from '#/modules/Extension/services/scripting';

export const executeCommand = inject({ extensionStore, appendLog })(({ extensionStore: store, appendLog: log }) => {
    return function executeCommand(commandId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }

        const cmd = state.commands.find((c) => c.id === commandId);
        if (!cmd) {
            log('error', `Command not found: ${commandId}`);
            return;
        }

        try {
            const result = cmd.handler();
            if (result instanceof Promise) {
                result.catch((err) => log('error', `Command error: ${err}`));
            }
        } catch (err) {
            log('error', `Command error: ${err}`);
        }
    };
});
