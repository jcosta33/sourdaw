import { updateClip } from '../../repositories/track/updateClip';

export function setClipStretchMode(clipId: string, mode: unknown): boolean {
    const isSupportedMode = mode === 'off' || mode === 'repitch' || mode === 'timestretch';
    if (!isSupportedMode) {
        return false;
    }

    return updateClip(clipId, (context) => ({ ...context, stretchMode: mode }));
}
