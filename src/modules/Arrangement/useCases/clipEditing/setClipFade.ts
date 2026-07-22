import { updateClip } from '../../repositories/track/updateClip';

export function setClipFade(clipId: string, fadeInBeats: number, fadeOutBeats: number): boolean {
    return updateClip(clipId, (context) => ({
        ...context,
        fadeInBeats: Math.max(0, fadeInBeats),
        fadeOutBeats: Math.max(0, fadeOutBeats),
    }));
}
