import { inject } from '#/infra/di/inject';
import { extensionStore } from '#/modules/Extension/stores/extension';

export const toggleScriptEditor = inject({ extensionStore })(({ extensionStore: store }) => {
    return function toggleScriptEditor(): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, editorOpen: !state.editorOpen });
    };
});
