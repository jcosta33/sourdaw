import { updateClip } from '../../repositories/track/updateClip';

export function restoreClipLoopLength(clipId: string, loopLength: number | undefined): boolean {
    return updateClip(clipId, (clip) => {
        const restored = { ...clip };
        if (loopLength === undefined) {
            delete restored.loopLength;
        } else {
            restored.loopLength = loopLength;
        }
        return restored;
    });
}
