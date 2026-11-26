import { type Clip } from '../../models/Track';

/** The beats a nudge writes onto a clip; an absent anchor means the clip carries none. */
export type ClipPlacement = {
    startBeat: number;
    endBeat: number;
    loopOriginBeat?: number;
    audioLoopPassOriginBeat?: number;
};

/** The placement the clip holds now, exactly as stored. */
export function readClipPlacement(clip: Clip): ClipPlacement {
    const placement: ClipPlacement = { startBeat: clip.startBeat, endBeat: clip.endBeat };
    if (clip.loopOriginBeat !== undefined) {
        placement.loopOriginBeat = clip.loopOriginBeat;
    }
    if (clip.audioLoopPassOriginBeat !== undefined) {
        placement.audioLoopPassOriginBeat = clip.audioLoopPassOriginBeat;
    }
    return placement;
}
