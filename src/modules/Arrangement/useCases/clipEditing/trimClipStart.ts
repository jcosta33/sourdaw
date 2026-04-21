import { updateClip } from '../../repositories/track/updateClip';

export function trimClipStart(clipId: string, newStartBeat: number): void {
    updateClip(clipId, (context) => {
        if (newStartBeat < context.endBeat) {
            const startBeat = Math.max(0, newStartBeat);
            const delta = startBeat - context.startBeat;
            return {
                ...context,
                startBeat,
                audioOffsetBeats: (context.audioOffsetBeats ?? 0) + delta,
            };
        }
        return context;
    });
}
