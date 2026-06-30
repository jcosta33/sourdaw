import { extensionStore, type ScriptCommand } from '../../stores/extension';

export function registerCommand(
    extensionId: string,
    id: string,
    label: string,
    description: string,
    handler: () => void | Promise<void>
): void {
    if (!extensionStore.value) {
        return;
    }

    const command: ScriptCommand = { id: `${extensionId}.${id}`, extensionId, label, description, handler };

    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return {
            ...state,
            commands: [...state.commands.filter((registeredCommand) => registeredCommand.id !== command.id), command],
        };
    });
}
