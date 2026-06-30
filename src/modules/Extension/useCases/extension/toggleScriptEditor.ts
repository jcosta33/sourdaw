import { extensionStore } from '../../stores/extension';

export function toggleScriptEditor(): void {
    if (!extensionStore.value) {
        return;
    }

    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return { ...state, editorOpen: !state.editorOpen };
    });
}
