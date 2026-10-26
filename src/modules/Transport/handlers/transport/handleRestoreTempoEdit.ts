import { createHandler } from '#/utils/createHandler';

import { markTempoProjectWrite } from '../../useCases/markTempoProjectWrite';
import { assertTempoWriteBpm } from '../../useCases/assertTempoWriteBpm';
import { getTempoWriteTarget } from '../../useCases/transportQueries/getTempoWriteTarget';
import {
    isRestoreTempoEditPayload,
    tempoAudioSourcesApply,
    tempoPrefixTarget,
    writeTempoEdit,
} from './tempoAudioSourceEdit';

export const handleRestoreTempoEdit = createHandler<'restoreTempoEdit'>({
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    canReportConflict: true,
    canReapplyAfterDivergence: (action) => isRestoreTempoEditPayload(action.payload),
    validateMaterializedCommandArguments: isRestoreTempoEditPayload,
    validateSessionActionArguments: isRestoreTempoEditPayload,
    validate: (action, context) => {
        const target = tempoPrefixTarget(action, context);
        return (
            isRestoreTempoEditPayload(action.payload) &&
            target?.writable === true &&
            target.tempo === action.payload.expectedBpm &&
            tempoAudioSourcesApply(action.payload, context)
        );
    },
    execute: (action, context) => {
        if (!isRestoreTempoEditPayload(action.payload)) {
            return { status: 'conflict' };
        }
        const target = getTempoWriteTarget({ tempoChangeId: action.payload.tempoChangeId });
        if (!target?.writable || target.tempo !== action.payload.expectedBpm) {
            return { status: 'conflict' };
        }
        assertTempoWriteBpm(action.payload.bpm, target.tempoChangeId);
        const result = writeTempoEdit(action.payload, context);
        if (result.status === 'conflict') {
            return { status: 'conflict' };
        }
        return {
            status: 'written',
            commitValidation: result.commitValidation,
            afterCommit: markTempoProjectWrite,
            afterAmbiguousCommit: markTempoProjectWrite,
        };
    },
    describe: () => ({ label: 'Restore tempo edit', inverseAction: null }),
    undoable: false,
});
