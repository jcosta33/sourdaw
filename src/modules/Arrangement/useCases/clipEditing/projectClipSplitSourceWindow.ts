import { restampLoopOriginEntry, shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';

import { consumedStretchFactor } from './consumedStretchFactor';

/** The actual right-fragment media basis, shared by production and saved replay admission. */
export function projectClipSplitSourceWindow(clip: Clip, splitBeat: number) {
    const timelineDelta = splitBeat - clip.startBeat;
    const contentDelta = timelineDelta * consumedStretchFactor(clip);
    return {
        audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + contentDelta,
        midiOffsetBeats: 0,
        ...(clip.type === 'midi'
            ? restampLoopOriginEntry(clip, splitBeat)
            : shiftLoopOriginEntry(clip, timelineDelta - contentDelta)),
    };
}
