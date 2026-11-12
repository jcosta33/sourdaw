import { clearClipPitchAnalysis } from '#/modules/Knead/useCases';
import { createHandler } from '#/utils/createHandler';

import { applyRelinkAudioSourceTargets } from '../../useCases/clipEditing/applyRelinkAudioSourceTargets';
import { captureRelinkAudioSourceCommitValidation } from '../../useCases/clipEditing/captureRelinkAudioSourceCommitValidation';
import { relinkAudioSourceTargetsMatch } from '../../useCases/clipEditing/relinkAudioSourceTargetsMatch';

export const handleRelinkClipAudioSources = createHandler<'relinkClipAudioSources'>({
    validate: (action) => relinkAudioSourceTargetsMatch(action.payload.targets),
    canReportConflict: true,
    execute: (action) => {
        if (!relinkAudioSourceTargetsMatch(action.payload.targets)) {
            return { status: 'conflict' };
        }
        const commitValidation = captureRelinkAudioSourceCommitValidation(action.payload.targets);
        applyRelinkAudioSourceTargets(action.payload.targets);
        for (const clipId of new Set(action.payload.targets.map((target) => target.clipId))) {
            clearClipPitchAnalysis(clipId);
        }
        return { status: 'written', commitValidation };
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
