import { inject } from '#/infra/di/inject';
import { extensionStore, type ScriptCommand } from '#/modules/Extension/stores/extension';

export const getExtensionCommands = inject({ extensionStore })(({ extensionStore: store }) => {
    return function getExtensionCommands(): ScriptCommand[] {
        return store.value?.commands ?? [];
    };
});
