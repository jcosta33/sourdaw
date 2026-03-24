import { updateClip } from '#/modules/Arrangement/repositories/trackRepository';

export function trimClipStart(clipId: string, newStartBeat: number): void {
    updateClip(clipId, (c) => (newStartBeat < c.endBeat ? { ...c, startBeat: Math.max(0, newStartBeat) } : c));
}
