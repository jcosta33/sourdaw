import { duplicateClipCore } from './duplicateClipCore';

type DuplicateClipInput = string | { clipId: string; targetClipId?: string };

export function duplicateClip(input: DuplicateClipInput) {
    const clipId = typeof input === 'string' ? input : input.clipId;
    const targetClipId = typeof input === 'string' ? undefined : input.targetClipId;

    return duplicateClipCore({
        clipId,
        targetClipId,
        computeStartBeat: (clip) => clip.endBeat,
    });
}
