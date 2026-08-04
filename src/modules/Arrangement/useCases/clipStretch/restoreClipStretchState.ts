import { type ClipStretchStateSnapshot } from '#/utils/handlerContract';

import { updateClip } from '../../repositories/track/updateClip';

type RestoreClipStretchStateInput = {
    clipId: string;
    state: ClipStretchStateSnapshot;
};

export function restoreClipStretchState({ clipId, state }: RestoreClipStretchStateInput): boolean {
    return updateClip(clipId, (clip) => {
        const updatedClip = { ...clip, startBeat: state.startBeat, endBeat: state.endBeat };
        if (state.mode.present) {
            updatedClip.stretchMode = state.mode.value;
        } else {
            delete updatedClip.stretchMode;
        }
        if (state.ratio.present) {
            updatedClip.stretchRatio = state.ratio.value;
        } else {
            delete updatedClip.stretchRatio;
        }
        return updatedClip;
    });
}
