import { clearClipPitchAnalysis } from '#/modules/Knead/useCases';
import { createHandler } from '#/utils/createHandler';

import { applyRelinkAudioSourceTargets } from '../../useCases/clipEditing/applyRelinkAudioSourceTargets';
import { captureRelinkAudioSourceCommitValidation } from '../../useCases/clipEditing/captureRelinkAudioSourceCommitValidation';
import { relinkAudioSourceTargetsMatch } from '../../useCases/clipEditing/relinkAudioSourceTargetsMatch';

export const handleRelinkClipAudioSources = createHandler<'relinkClipAudioSources'>({
    validate: (action, context) => relinkAudioSourceTargetsMatch(action.payload.targets, context),
    canReportConflict: true,
    execute: (action, context) => {
        if (!relinkAudioSourceTargetsMatch(action.payload.targets)) {
            return { status: 'conflict' };
        }
        if (context?.executionMode === 'isolated-preview') {
            applyRelinkAudioSourceTargets(action.payload.targets);
            for (const clipId of new Set(action.payload.targets.map((target) => target.clipId))) {
                clearClipPitchAnalysis(clipId);
            }
            return { status: 'written' };
        }
        const guard = captureRelinkAudioSourceCommitValidation(action.payload.targets, context);
        try {
            applyRelinkAudioSourceTargets(action.payload.targets);
            if (!guard.captureWrittenState()) {
                guard.validation.release();
                return { status: 'conflict' };
            }
            for (const clipId of new Set(action.payload.targets.map((target) => target.clipId))) {
                clearClipPitchAnalysis(clipId);
            }
            return { status: 'written', commitValidation: guard.validation };
        } catch (error) {
            guard.validation.release();
            throw error;
        }
    },
    describe: (action) => ({
        label: 'Relink audio source',
        inverseAction: {
            type: 'relinkClipAudioSources',
            payload: {
                targets: action.payload.targets.map((target) => ({
                    ...target,
                    before: target.after,
                    after: target.before,
                })),
            },
        },
        redoAction: action,
    }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
