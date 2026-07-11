import { appendDsoEditorEdit } from '../../stores/dsoEditorState';

export function logEdit(summary: string): void {
    appendDsoEditorEdit(summary);
}
