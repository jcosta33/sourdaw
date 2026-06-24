import { extensionStore, type ScriptCommand } from '../../stores/extension';

export function getExtensionCommands(): ScriptCommand[] {
    return [...(extensionStore.value?.commands ?? [])];
}
