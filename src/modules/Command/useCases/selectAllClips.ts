import { selectAllClips as selectAllClipsInArrangement } from '#/modules/Arrangement/useCases';

import { getAllClipIds } from './selectionHelpers/getAllClipIds';

export function selectAllClips(): void {
    selectAllClipsInArrangement(getAllClipIds);
}
