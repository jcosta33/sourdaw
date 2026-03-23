import { updateClip } from '#/modules/Track/repositories/trackRepository';

export function trimClipEnd(clipId: string, newEndBeat: number): void {
    updateClip(clipId, (c) => (newEndBeat > c.startBeat ? { ...c, endBeat: newEndBeat } : c));
}
