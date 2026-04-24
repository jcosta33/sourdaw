import { type ProjectMidiNote } from '../../../models/ProjectData';

type DemoMidiClipKneadBlob = {
    id: string;
    startTime: number;
    endTime: number;
    pitchCenterCents: number;
    pitchCurveCents: number[];
    voicedConfidence: number;
};

type DemoMidiClipKneadState = {
    blobs: DemoMidiClipKneadBlob[];
    retuneSpeedMs: number;
    humanizePercent: number;
    formantPreserve: boolean;
};

type DemoMidiClip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'midi';
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
    notes: ProjectMidiNote[];
    // Optional Clip-model fields consumed by demos to showcase non-destructive linking,
    // pitch correction, and scale folding. Left undefined for plain clips.
    parentClipId?: string;
    isLinkedInstance?: boolean;
    kneadState?: DemoMidiClipKneadState;
};

export function createMidiClip(
    trackId: string,
    name: string,
    startBeat: number,
    endBeat: number,
    color = ''
): DemoMidiClip {
    return {
        id: `clip-${crypto.randomUUID()}`,
        trackId,
        name,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color,
        locked: false,
        muted: false,
        notes: [],
    };
}
