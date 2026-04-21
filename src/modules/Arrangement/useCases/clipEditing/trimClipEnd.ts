import { updateClip } from '../../repositories/track/updateClip';

export function trimClipEnd(clipId: string, newEndBeat: number): void {
    updateClip(clipId, (context) => (newEndBeat > context.startBeat ? { ...context, endBeat: newEndBeat } : context));
}
