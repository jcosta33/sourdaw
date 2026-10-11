import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { audioSourceAtBeat } from '../../useCases/clipEditing/audioSourceAtBeat';
import { audioSourceStateMatches } from '../../useCases/clipEditing/audioSourceStateMatches';
import { captureAudioSourceState } from '../../useCases/clipEditing/captureAudioSourceState';
import { isAudioSourceStateSnapshot } from '../../useCases/clipEditing/isAudioSourceStateSnapshot';
import { projectClipReplayPrefix } from '../../useCases/clipEditing/projectClipReplayPrefix';
import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type TrimClipStartAction = Extract<AppAction, { type: 'trimClipStart' }>;
type Description = { label: string; inverseAction: TrimClipStartAction | null; redoAction?: TrimClipStartAction };
const pendingDescriptions = new WeakMap<TrimClipStartAction, Description>();

function expectedAudioSourceMatches(action: TrimClipStartAction, context?: HandlerValidationContext): boolean {
    const { expectedAudioSource, restoreAudioSource } = action.payload;
    if (expectedAudioSource === undefined && restoreAudioSource === undefined) {
        return true;
    }
    if (!isAudioSourceStateSnapshot(expectedAudioSource) || !isAudioSourceStateSnapshot(restoreAudioSource)) {
        return false;
    }
    const clip = projectClipReplayPrefix(context?.actions.slice(0, context.actionIndex))?.clips.find(
        (owner) => owner.clip.id === action.payload.clipId
    )?.clip;
    return clip?.type === 'audio' && audioSourceStateMatches(clip, expectedAudioSource);
}

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    validate: expectedAudioSourceMatches,
    execute: (alpha) => {
        const pending = pendingDescriptions.get(alpha);
        try {
            if (!expectedAudioSourceMatches(alpha)) {
                return { status: 'conflict' };
            }
            // Earlier group members have now applied. Capture the source this
            // trim actually receives, including materialization by a tempo edit.
            const actual = describeTrim(alpha);
            const written = trimClipStart(
                alpha.payload.clipId,
                alpha.payload.newStartBeat,
                alpha.payload.restoreAudioSource
            );
            if (written && pending) {
                Object.assign(pending, actual);
            }
            return toHandlerExecutionResult(written);
        } finally {
            pendingDescriptions.delete(alpha);
        }
    },
    describe: (alpha) => {
        const description = describeTrim(alpha);
        pendingDescriptions.set(alpha, description);
        return description;
    },
    undoable: true,
});

function describeTrim(alpha: TrimClipStartAction): Description {
    const label = 'Trim clip start';
    try {
        const state = getTrackStoreState();
        const clip = state?.tracks.flatMap((time) => time.clips).find((context) => context.id === alpha.payload.clipId);
        if (!clip) {
            return { label, inverseAction: null };
        }

        const inversePayload: Extract<AppAction, { type: 'trimClipStart' }>['payload'] = {
            clipId: clip.id,
            newStartBeat: clip.startBeat,
        };
        let redoAction: TrimClipStartAction | undefined;
        if (clip.type === 'audio') {
            const previousSource = captureAudioSourceState(clip);
            const nextSource =
                alpha.payload.restoreAudioSource ?? audioSourceAtBeat(clip, Math.max(0, alpha.payload.newStartBeat));
            inversePayload.restoreAudioSource = previousSource;
            inversePayload.expectedAudioSource = nextSource;
            redoAction = {
                type: 'trimClipStart',
                payload: {
                    clipId: clip.id,
                    newStartBeat: alpha.payload.newStartBeat,
                    expectedAudioSource: previousSource,
                    restoreAudioSource: nextSource,
                },
            };
        }

        return {
            label,
            inverseAction: {
                type: 'trimClipStart',
                payload: inversePayload,
            },
            redoAction,
        };
    } catch {
        return { label, inverseAction: null };
    }
}
