import { midiFragmentWindowEntry, shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';

import { consumedStretchFactor } from './consumedStretchFactor';

function loopLengthEntry(clip: Clip): { loopLength: number } | Record<string, never> {
    return clip.loopLength === undefined ? {} : { loopLength: clip.loopLength };
}

/** The actual right-fragment media basis, shared by production and saved replay admission. */
export function projectClipSplitSourceWindow(clip: Clip, splitBeat: number) {
    const timelineDelta = splitBeat - clip.startBeat;
    const contentDelta = timelineDelta * consumedStretchFactor(clip);
    if (clip.type === 'midi') {
        return {
            audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + contentDelta,
            ...loopLengthEntry(clip),
            ...midiFragmentWindowEntry(clip, splitBeat, splitBeat),
        };
    }
    return {
        audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + contentDelta,
        midiOffsetBeats: 0,
        ...loopLengthEntry(clip),
        ...shiftLoopOriginEntry(clip, timelineDelta - contentDelta),
    };
}
