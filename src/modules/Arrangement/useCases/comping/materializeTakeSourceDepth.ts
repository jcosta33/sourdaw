import { resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';

import { type Take } from '../../models/TakeLane';

/** Resolve a legacy take against its original clip start, before a time edit moves either. */
export function materializeTakeSourceDepth(take: Take, originalClipTempo: number | undefined): Take {
    if (
        (take.passAnchorSeconds !== undefined && take.passDepthSeconds !== undefined) ||
        originalClipTempo === undefined ||
        (take.sourceOffsetBeats === undefined && take.sourceOffsetSeconds === undefined)
    ) {
        return take;
    }
    return {
        ...take,
        sourceOffsetSeconds: resolveAudioSourceOffsetSeconds(
            { audioOffsetSeconds: take.sourceOffsetSeconds, audioOffsetBeats: take.sourceOffsetBeats },
            originalClipTempo
        ),
    };
}
