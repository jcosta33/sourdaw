import { updateClip } from '#/modules/Track/repositories/trackRepository';

export function nudgeClip(clipId: string, beats: number): void {
    updateClip(clipId, (c) => {
        if (c.locked) {
            return c;
        }
        const newStart = Math.max(0, c.startBeat + beats);
        const duration = c.endBeat - c.startBeat;
        return { ...c, startBeat: newStart, endBeat: newStart + duration };
    });
}
