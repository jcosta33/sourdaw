import { extensionStore } from '../../stores/extension';

export function setEditorContent(content: string): void {
    extensionStore.update((state) => {
        if (!state) {
            return state;
        }

        return { ...state, editorContent: content };
    });
}
