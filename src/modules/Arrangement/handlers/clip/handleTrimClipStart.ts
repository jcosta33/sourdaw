import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { audioSourceAtBeat } from '../../useCases/clipEditing/audioSourceAtBeat';
import { audioSourceStateMatches } from '../../useCases/clipEditing/audioSourceStateMatches';
import { captureAudioSourceState } from '../../useCases/clipEditing/captureAudioSourceState';
import { isAudioSourceStateSnapshot } from '../../useCases/clipEditing/isAudioSourceStateSnapshot';
import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type TrimClipStartAction = Extract<AppAction, { type: 'trimClipStart' }>;

function expectedAudioSourceMatches(action: TrimClipStartAction): boolean {
    const { expectedAudioSource, restoreAudioSource } = action.payload;
    if (expectedAudioSource === undefined && restoreAudioSource === undefined) {
        return true;
    }
    if (!isAudioSourceStateSnapshot(expectedAudioSource) || !isAudioSourceStateSnapshot(restoreAudioSource)) {
        return false;
    }
    const clip = getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === action.payload.clipId);
    return clip?.type === 'audio' && audioSourceStateMatches(clip, expectedAudioSource);
}

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    validate: expectedAudioSourceMatches,
    execute: (alpha) => {
        if (!expectedAudioSourceMatches(alpha)) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(
            trimClipStart(alpha.payload.clipId, alpha.payload.newStartBeat, alpha.payload.restoreAudioSource)
        );
    },
    describe: (alpha) => {
        const label = 'Trim clip start';
        try {
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === alpha.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }

            const inversePayload: Extract<AppAction, { type: 'trimClipStart' }>['payload'] = {
                clipId: clip.id,
                newStartBeat: clip.startBeat,
            };
            if (clip.type === 'audio') {
                inversePayload.restoreAudioSource = captureAudioSourceState(clip);
                inversePayload.expectedAudioSource = audioSourceAtBeat(clip, Math.max(0, alpha.payload.newStartBeat));
            }

            return {
                label,
                inverseAction: {
                    type: 'trimClipStart',
                    payload: inversePayload,
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
