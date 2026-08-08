import { type Clip } from '../../models/Track';

export function isPlainMidiGlueClip(clip: Clip): boolean {
    return (
        clip.type === 'midi' &&
        !clip.locked &&
        !clip.muted &&
        clip.gain === 1 &&
        !clip.loopEnabled &&
        (clip.stretchMode === undefined || clip.stretchMode === 'off') &&
        (clip.stretchRatio === undefined || clip.stretchRatio === 1) &&
        clip.followAction === undefined &&
        clip.generating !== true &&
        clip.isGhost !== true &&
        clip.parentClipId === undefined &&
        clip.isLinkedInstance !== true &&
        clip.sourceKeyRoot === undefined &&
        clip.sourceScaleName === undefined &&
        clip.overrides === undefined &&
        clip.kneadState === undefined
    );
}
