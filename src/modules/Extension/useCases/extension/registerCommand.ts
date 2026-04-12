import { extensionStore, type ScriptCommand } from '../../stores/extension';

export function registerCommand(
    extensionId: string,
    id: string,
    label: string,
    description: string,
    handler: () => void | Promise<void>
): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }

    const command: ScriptCommand = { id: `${extensionId}.${id}`, extensionId, label, description, handler };

    extensionStore.set({
        ...state,
        commands: [...state.commands.filter((c) => c.id !== command.id), command],
    });
}
