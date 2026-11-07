import { getArrangementHandlers, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

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
    // Resolve lazily: the owning handler map also reaches AudioEngine's public contract.
    execute: (action, context) => {
        if (!isAudioClipTarget(action)) {
            return { status: 'conflict', reason: INVALID_TARGET_REASON };
        }
        return getArrangementHandlers().setClipStretchMode.execute(repitchAction(action), context);
    },
    describe: (action, context) => getArrangementHandlers().setClipStretchMode.describe(repitchAction(action), context),
    validate: isAudioClipTarget,
    validationRefusalReason: () => INVALID_TARGET_REASON,
    canReportConflict: true,
    isNoop: (action) =>
        isAudioClipTarget(action) &&
        (getArrangementHandlers().setClipStretchMode.isNoop?.(repitchAction(action)) ?? false),
    // The owning stretch handler admits only singleton batches.
    batchExecution: 'singleton',
    undoable: true,
});
