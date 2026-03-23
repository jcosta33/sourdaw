import { extensionStore } from '#/modules/Extension/stores/extension';

export function setEditorContent(content: string): void {
    const state = extensionStore.value;
    if (!state) {
        return;
    }
    extensionStore.set({ ...state, editorContent: content });
}
