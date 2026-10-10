import { trackStore } from '#/modules/Arrangement/stores';
import { createAppActionCommittedError, executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { detectProjectTempo } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';
import { type HandlerExecutionResult, type HandlerValidationContext } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { detectTempo as detectTempoFromBuffer } from '../../useCases/tempoDetection';

async function completeProjectDetection(
    result: ReturnType<typeof detectProjectTempo>,
    context?: HandlerValidationContext
): Promise<HandlerExecutionResult> {
    if (result.confidence <= 0.5 || result.normalizedBpm === null) {
        notifyUser('Could not confidently detect tempo — add more content first', 'warning');
        return { status: 'no-write' };
    }

    let committed = false;
    try {
        await executeAppAction(
            { type: 'setTempo', payload: { bpm: result.normalizedBpm, tempoChangeId: null } },
            {
                signal: context?.signal,
                onDeferredEffectAttempt: context?.onDeferredEffectAttempt,
                workOwner: context?.workOwner,
                shouldExecute: () => context?.signal?.aborted !== true,
                onCommitted: () => {
                    committed = true;
                },
            }
        );
        if (context?.signal?.aborted && !committed) {
            return { status: 'no-write' };
        }
        notifyUser(`Detected tempo: ${result.averageBpm} BPM (${result.minBpm}–${result.maxBpm} range)`, 'success');
        return { status: committed ? 'written' : 'no-write' };
    } catch (error) {
        if (committed || isAppActionCommittedError(error)) {
            throw createAppActionCommittedError({ actionType: 'detectTempo', cause: error });
        }
        throw error;
    }
}

export const handleDetectTempo = createHandler<'detectTempo'>({
    executionKind: 'runtime',
    execute: (action, context) => {
        if (context?.signal?.aborted) {
            return { status: 'no-write' };
        }
        const clip = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (clip?.audioBufferId) {
            const bpm = detectTempoFromBuffer(clip.audioBufferId);
            if (bpm) {
                notifyUser(`Detected tempo: ${bpm} BPM`);
            } else {
                notifyUser('Could not detect tempo');
            }
            return { status: 'no-write' };
        }

        const result = detectProjectTempo();
        return completeProjectDetection(result, context);
    },
    describe: () => ({ label: 'Detect tempo' }),
    // The admitted setTempo child owns the project write and its undo entry.
    undoable: false,
});
