import { updateClip } from '../../repositories/track/updateClip';

export function trimClipEnd(clipId: string, newEndBeat: number): void {
    updateClip(clipId, (c) => (newEndBeat > c.startBeat ? { ...c, endBeat: newEndBeat } : c));
}
