import { updateClip } from '../../repositories/track/updateClip';

import type { StretchMode } from '../../models/Track';

export function setClipStretchMode(clipId: string, mode: StretchMode): boolean {
    const isSupportedMode = mode === 'off' || mode === 'repitch' || mode === 'timestretch';
    if (!isSupportedMode) {
        return false;
    }

    return updateClip(clipId, (context) => ({ ...context, stretchMode: mode }));
}
