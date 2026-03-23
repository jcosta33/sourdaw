import { updateClip } from '#/modules/Track/repositories/trackRepository';

export function setClipFade(clipId: string, fadeInBeats: number, fadeOutBeats: number): void {
    updateClip(clipId, (c) => ({
        ...c,
        fadeInBeats: Math.max(0, fadeInBeats),
        fadeOutBeats: Math.max(0, fadeOutBeats),
    }));
}
