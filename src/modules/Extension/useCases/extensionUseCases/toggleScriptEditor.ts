import { extensionStore } from '#/modules/Extension/stores/extension';

export function toggleScriptEditor(): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }
    extensionStore.set({ ...state, editorOpen: !state.editorOpen });
}
