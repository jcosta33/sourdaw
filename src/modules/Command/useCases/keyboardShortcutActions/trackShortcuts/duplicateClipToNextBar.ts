import { duplicateClipToNextBar as duplicateClipToNextBarImpl } from '#/modules/Arrangement/useCases';

export function duplicateClipToNextBar(clipId: string) {
    return duplicateClipToNextBarImpl(clipId);
}