import { updateClip } from '../../repositories/track/updateClip';

export function trimClipEnd(clipId: string, newEndBeat: number): boolean {
    return updateClip(clipId, (context) => {
        if (newEndBeat <= context.startBeat) {
            return context;
        }

        return { ...context, endBeat: newEndBeat };
    });
}
