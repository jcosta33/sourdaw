import { updateClip } from '../../repositories/track/updateClip';

export function setClipFade(clipId: string, fadeInBeats: number, fadeOutBeats: number): void {
    updateClip(clipId, (context) => ({
        ...context,
        fadeInBeats: Math.max(0, fadeInBeats),
        fadeOutBeats: Math.max(0, fadeOutBeats),
    }));
}
