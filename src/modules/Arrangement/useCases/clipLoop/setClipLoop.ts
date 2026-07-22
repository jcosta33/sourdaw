import { updateClip } from '../../repositories/track/updateClip';

export function setClipLoop(clipId: string, enabled: boolean): boolean {
    return updateClip(clipId, (context) => ({ ...context, loopEnabled: enabled }));
}
