import { inject } from '#/infra/di/inject';
import { extensionStore, type ScriptCommand } from '#/modules/Extension/stores/extension';

export const registerCommand = inject({ extensionStore })(({ extensionStore: store }) => {
    return function registerCommand(
        extensionId: string,
        id: string,
        label: string,
        description: string,
        handler: () => void | Promise<void>
    ): void {
        const state = store.value;
        if (!state) {
            return;
        }

        const command: ScriptCommand = { id: `${extensionId}.${id}`, extensionId, label, description, handler };

        store.set({
            ...state,
            commands: [...state.commands.filter((c) => c.id !== command.id), command],
        });
    };
});
