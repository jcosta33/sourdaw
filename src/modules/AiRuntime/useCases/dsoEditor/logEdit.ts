import { dsoEditorState } from '../../stores/dsoEditorState';

export function logEdit(summary: string): void {
    dsoEditorState.update((currentState) => ({
        revision: currentState?.revision ?? 0,
        recent_edits: [...(currentState?.recent_edits ?? []), summary].slice(-5),
    }));
}
