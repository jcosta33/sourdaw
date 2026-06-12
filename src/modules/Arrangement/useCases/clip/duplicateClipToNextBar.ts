import { transportStore } from '#/modules/Transport/stores';

import { duplicateClipCore } from './duplicateClipCore';

export function duplicateClipToNextBar(clipId: string): void {
    const transport = transportStore.value;
    const beatsPerBar = transport?.timeSignatureNumerator ?? 4;

    duplicateClipCore(clipId, (clip) => Math.ceil(clip.endBeat / beatsPerBar) * beatsPerBar);
}
