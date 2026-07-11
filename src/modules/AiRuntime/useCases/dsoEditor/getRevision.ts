import { getDsoEditorRevision } from '../../stores/dsoEditorState';

export function getRevision(): number {
    return getDsoEditorRevision();
}
