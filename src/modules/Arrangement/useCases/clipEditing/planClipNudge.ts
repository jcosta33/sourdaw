import { shiftLoopOrigin } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';
import { relocateAudioSourceTimeFields } from '../clip/relocateAudioSourceTimeFields';

import { type ClipPlacement, readClipPlacement } from './readClipPlacement';

/**
 * The placement a nudge leaves the clip at, as a pure law over the clip as it stands. A locked clip
 * stays. A recorded inverse or redo carries the exact placement to write, so undo restores the
 * prior beats bit-for-bit; a fresh nudge moves the rectangle by `beats`, clamped at beat 0, and the
 * loop anchor and the audio pass anchor ride the applied delta (#4988).
 */
export function planClipNudge(clip: Clip, beats: number, placement?: ClipPlacement): ClipPlacement {
    if (clip.locked) {
        return readClipPlacement(clip);
    }
    if (placement) {
        return placement;
    }
    if (!Number.isFinite(beats)) {
        return readClipPlacement(clip);
    }
    const startBeat = Math.max(0, clip.startBeat + beats);
    const appliedDelta = startBeat - clip.startBeat;
    const moved: ClipPlacement = { startBeat, endBeat: startBeat + (clip.endBeat - clip.startBeat) };
    const loopOriginBeat = shiftLoopOrigin(clip, appliedDelta);
    if (loopOriginBeat !== undefined) {
        moved.loopOriginBeat = loopOriginBeat;
    }
    const audioLoopPassOriginBeat = relocateAudioSourceTimeFields(clip, appliedDelta).audioLoopPassOriginBeat;
    if (audioLoopPassOriginBeat !== undefined) {
        moved.audioLoopPassOriginBeat = audioLoopPassOriginBeat;
    }
    return moved;
}
