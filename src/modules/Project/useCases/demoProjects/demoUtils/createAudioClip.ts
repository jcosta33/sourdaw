import type { StretchMode } from '../../../models/DemoProjectTypes';

export function createAudioClip(
    trackId: string,
    name: string,
    startBeat: number,
    endBeat: number,
    bufferId: string,
    color = ''
) {
    return {
        id: `clip-${crypto.randomUUID()}`,
        trackId,
        name,
        startBeat,
        endBeat,
        type: 'audio' as const,
        audioBufferId: bufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color,
        locked: false,
        muted: false,
        stretchMode: 'repitch' as StretchMode,
    };
}