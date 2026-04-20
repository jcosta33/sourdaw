import { updateClip } from '../../repositories/track/updateClip';

export function setClipLoop(clipId: string, enabled: boolean): void {
    updateClip(clipId, (c) => ({ ...c, loopEnabled: enabled }));
}
