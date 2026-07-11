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

export function getDsoEditorRevision(): number {
    return dsoEditorState.value?.revision ?? 0;
}

export function bumpDsoEditorRevision(): number {
    const currentState = dsoEditorState.value ?? initialDsoEditorState;
    const revision = currentState.revision + 1;
    dsoEditorState.set({ ...currentState, revision });
    return revision;
}

export function appendDsoEditorEdit(summary: string): void {
    const currentState = dsoEditorState.value ?? initialDsoEditorState;
    dsoEditorState.set({
        ...currentState,
        recent_edits: [...currentState.recent_edits, summary].slice(-5),
    });
}

export function getDsoEditorRecentEdits(): string[] {
    return [...(dsoEditorState.value?.recent_edits ?? [])];
}
