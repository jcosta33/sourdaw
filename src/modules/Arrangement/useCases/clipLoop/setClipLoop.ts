import { updateClip } from '../../repositories/track/updateClip';

export function setClipLoop(clipId: string, enabled: boolean | undefined): boolean {
    return updateClip(clipId, (context) => {
        const updatedClip = { ...context };
        if (enabled === undefined) {
            delete updatedClip.loopEnabled;
        } else {
            updatedClip.loopEnabled = enabled;
        }
        return updatedClip;
    });
}
