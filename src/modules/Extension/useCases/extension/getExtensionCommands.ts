import { extensionStore, type ScriptCommand } from '#/modules/Extension/stores/extension';

export function getExtensionCommands(): ScriptCommand[] {
    return extensionStore.value?.commands ?? [];
}
