import { restampLoopOriginEntry, shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';

import { consumedStretchFactor } from './consumedStretchFactor';

/** The actual right-fragment media basis, shared by production and saved replay admission. */
export function projectClipSplitSourceWindow(clip: Clip, splitBeat: number) {
    const timelineDelta = splitBeat - clip.startBeat;
    const contentDelta = timelineDelta * consumedStretchFactor(clip);
    if (clip.type === 'midi') {
        return {
            audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + contentDelta,
            midiOffsetBeats: 0,
            ...restampLoopOriginEntry(clip, splitBeat),
        };
    }
    return {
        audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + contentDelta,
        midiOffsetBeats: 0,
        ...shiftLoopOriginEntry(clip, timelineDelta - contentDelta),
    };
}
