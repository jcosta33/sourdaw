import { updateClip } from '#/modules/Arrangement/repositories/track';

export function trimClipStart(clipId: string, newStartBeat: number): void {
    updateClip(clipId, (c) => (newStartBeat < c.endBeat ? { ...c, startBeat: Math.max(0, newStartBeat) } : c));
}
