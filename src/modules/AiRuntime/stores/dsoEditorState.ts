import { createStore } from '#/infra/store/createStore';

type DsoEditorState = {
    revision: number;
    recent_edits: string[];
};

const initialDsoEditorState: DsoEditorState = {
    revision: 0,
    recent_edits: [],
};

export const dsoEditorState = createStore<DsoEditorState>({
    initialData: initialDsoEditorState,
});
