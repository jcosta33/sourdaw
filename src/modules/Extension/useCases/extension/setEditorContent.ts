import { inject } from '#/infra/di/inject';
import { extensionStore } from '#/modules/Extension/stores/extension';

export const setEditorContent = inject({ extensionStore })(({ extensionStore: store }) => {
    return function setEditorContent(content: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, editorContent: content });
    };
});
