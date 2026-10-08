import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { audioSourceAfterSlip } from '../../useCases/clipEditing/audioSourceAfterSlip';
import { audioSourceStateMatches } from '../../useCases/clipEditing/audioSourceStateMatches';
import { captureAudioSourceState } from '../../useCases/clipEditing/captureAudioSourceState';
import { isAudioSourceStateSnapshot } from '../../useCases/clipEditing/isAudioSourceStateSnapshot';
import { slipClipContent } from '../../useCases/clipEditing/slipClipContent';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type SlipClipContentAction = Extract<AppAction, { type: 'slipClipContent' }>;

function expectedAudioSourceMatches(action: SlipClipContentAction): boolean {
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

export const handleSlipClipContent = createHandler<'slipClipContent'>({
    validate: expectedAudioSourceMatches,
    execute: (action) => {
        if (!expectedAudioSourceMatches(action)) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(
            slipClipContent(
                action.payload.clipId,
                action.payload.clipType,
                action.payload.offset,
                action.payload.offsetSeconds,
                action.payload.restoreAudioSource
            )
        );
    },
    describe: (action) => {
        const label = 'Slip clip content';
        try {
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === action.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }
            // Slip sets the offset wholesale, so the exact inverse is the same
            // action carrying the offset captured before the write — 0 when the
            // clip never carried one, matching the gesture's own baseline.
            const previousOffset =
                action.payload.clipType === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0);
            const inversePayload: Extract<AppAction, { type: 'slipClipContent' }>['payload'] = {
                clipId: clip.id,
                clipType: action.payload.clipType,
                offset: previousOffset,
            };
            if (action.payload.clipType === 'audio') {
                inversePayload.restoreAudioSource = captureAudioSourceState(clip);
                inversePayload.expectedAudioSource = audioSourceAfterSlip(
                    clip,
                    action.payload.offset,
                    action.payload.offsetSeconds
                );
            }
            return {
                label,
                inverseAction: {
                    type: 'slipClipContent',
                    payload: inversePayload,
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
