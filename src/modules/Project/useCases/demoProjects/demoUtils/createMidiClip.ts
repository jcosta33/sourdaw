import { type ProjectMidiNote } from '../../../models/ProjectData';

export function createMidiClip(trackId: string, name: string, startBeat: number, endBeat: number, color = '') {
    return {
        id: `clip-${crypto.randomUUID()}`,
        trackId,
        name,
        startBeat,
        endBeat,
        type: 'midi' as const,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color,
        locked: false,
        muted: false,
        notes: [] as ProjectMidiNote[],
    };
}
