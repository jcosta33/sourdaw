import { extensionStore } from '../../stores/extension';

export function setEditorContent(content: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }
    extensionStore.set({ ...state, editorContent: content });
}
