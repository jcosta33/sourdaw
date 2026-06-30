import { extensionStore } from '../../stores/extension';

export function setEditorContent(content: string): void {
    if (!extensionStore.value) {
        return;
    }

    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return { ...state, editorContent: content };
    });
}
