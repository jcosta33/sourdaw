import { updateClip } from '../../repositories/track/updateClip';

export function trimClipStart(clipId: string, newStartBeat: number): void {
    updateClip(clipId, (c) => {
        if (newStartBeat < c.endBeat) {
            const startBeat = Math.max(0, newStartBeat);
            const delta = startBeat - c.startBeat;
            return {
                ...c,
                startBeat,
                audioOffsetBeats: (c.audioOffsetBeats ?? 0) + delta,
            };
        }
        return c;
    });
}
