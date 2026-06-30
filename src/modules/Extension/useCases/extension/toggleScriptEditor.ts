import { extensionStore } from '../../stores/extension';

export function toggleScriptEditor(): void {
    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return { ...state, editorOpen: !state.editorOpen };
    });
}
