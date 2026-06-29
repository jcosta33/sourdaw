import { transportStore } from '#/modules/Transport/stores';

import { duplicateClipCore } from './duplicateClipCore';

type DuplicateClipToNextBarInput = string | { clipId: string; targetClipId?: string };

export function duplicateClipToNextBar(input: DuplicateClipToNextBarInput) {
    const clipId = typeof input === 'string' ? input : input.clipId;
    const targetClipId = typeof input === 'string' ? undefined : input.targetClipId;
    const transport = transportStore.value;
    const beatsPerBar = transport?.timeSignatureNumerator ?? 4;

    return duplicateClipCore({
        clipId,
        targetClipId,
        computeStartBeat: (clip) => Math.ceil(clip.endBeat / beatsPerBar) * beatsPerBar,
    });
}
