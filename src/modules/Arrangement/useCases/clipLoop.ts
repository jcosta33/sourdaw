import { updateClip } from '#/modules/Arrangement/repositories/track';

export function setClipLoop(clipId: string, enabled: boolean): void {
    updateClip(clipId, (c) => ({ ...c, loopEnabled: enabled }));
}

export function setClipLoopLength(clipId: string, loopLength: number): void {
    if (loopLength <= 0) {
        return;
    }
    updateClip(clipId, (c) => ({ ...c, loopLength }));
}
