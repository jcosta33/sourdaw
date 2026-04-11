import { duplicateClip as duplicateClipImpl } from '#/modules/Arrangement/useCases';

export function duplicateClip(clipId: string) {
    return duplicateClipImpl(clipId);
}