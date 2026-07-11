import { dsoEditorState } from '../../stores/dsoEditorState';

export function getRevision(): number {
    return dsoEditorState.value?.revision ?? 0;
}
