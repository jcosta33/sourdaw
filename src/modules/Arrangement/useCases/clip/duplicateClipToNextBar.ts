import { getTransportState } from '#/modules/Transport/useCases';

import { duplicateClipCore } from './duplicateClipCore';

export function duplicateClipToNextBar(clipId: string): void {
    const transport = getTransportState();
    const beatsPerBar = transport?.timeSignatureNumerator ?? 4;

    duplicateClipCore(clipId, (clip) => Math.ceil(clip.endBeat / beatsPerBar) * beatsPerBar);
}
