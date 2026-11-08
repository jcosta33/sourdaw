import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

import { handleSetClipStretchMode } from './handleSetClipStretchMode';

type EnableWarpingAction = Extract<AppAction, { type: 'enableWarping' }>;
const INVALID_TARGET_REASON = 'Audio warping requires an existing audio clip.';

function isAudioClipTarget(action: EnableWarpingAction): boolean {
    return (
        getTrackStoreState()?.tracks.some((track) =>
            track.clips.some((clip) => clip.id === action.payload.clipId && clip.type === 'audio')
        ) ?? false
    );
}

function repitchAction(action: EnableWarpingAction) {
    return { type: 'setClipStretchMode', payload: { clipId: action.payload.clipId, mode: 'repitch' } } as const;
}

export const handleEnableWarping = createHandler<'enableWarping'>({
    execute: (action, context) => {
        if (!isAudioClipTarget(action)) {
            return { status: 'conflict', reason: INVALID_TARGET_REASON };
        }
        return handleSetClipStretchMode.execute(repitchAction(action), context);
    },
    describe: (action, context) => handleSetClipStretchMode.describe(repitchAction(action), context),
    validate: isAudioClipTarget,
    validationRefusalReason: () => INVALID_TARGET_REASON,
    canReportConflict: true,
    isNoop: (action) =>
        isAudioClipTarget(action) && (handleSetClipStretchMode.isNoop?.(repitchAction(action)) ?? false),
    // The owning stretch handler admits only singleton batches.
    batchExecution: 'singleton',
    undoable: true,
});
