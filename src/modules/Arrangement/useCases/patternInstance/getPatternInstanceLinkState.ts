import { type AppAction } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

type LinkState = Extract<AppAction, { type: 'restorePatternInstanceLink' }>['payload']['expected'];

export function getPatternInstanceLinkState(clipId: string): { trackId: string; state: LinkState } | null {
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible' || !('clipId' in target)) {
        return null;
    }
    const clip = trackStore.value?.tracks
        .find((track) => track.id === target.trackId)
        ?.clips.find((candidate) => candidate.id === clipId);
    if (!clip) {
        return null;
    }
    return {
        trackId: target.trackId,
        state: {
            parentClipId:
                clip.parentClipId === undefined ? { present: false } : { present: true, value: clip.parentClipId },
            overrides:
                clip.overrides === undefined
                    ? { present: false }
                    : { present: true, value: structuredClone(clip.overrides) },
        },
    };
}
