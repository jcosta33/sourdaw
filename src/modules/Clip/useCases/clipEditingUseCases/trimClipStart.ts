import { updateClip } from '#/modules/Track/repositories/trackRepository';

export function trimClipStart(clipId: string, newStartBeat: number): void {
    updateClip(clipId, (c) => (newStartBeat < c.endBeat ? { ...c, startBeat: Math.max(0, newStartBeat) } : c));
}
