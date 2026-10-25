import { createHandler } from '#/utils/createHandler';

import { markTempoProjectWrite } from '../../useCases/markTempoProjectWrite';
import { assertTempoWriteBpm } from '../../useCases/assertTempoWriteBpm';
import { getTempoWriteTarget } from '../../useCases/transportQueries/getTempoWriteTarget';
import { isRestoreTempoEditPayload, tempoAudioSourcesApply, writeTempoEdit } from './tempoAudioSourceEdit';

export const handleRestoreTempoEdit = createHandler<'restoreTempoEdit'>({
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    canReportConflict: true,
    canReapplyAfterDivergence: (action) => isRestoreTempoEditPayload(action.payload),
    validateMaterializedCommandArguments: isRestoreTempoEditPayload,
    validateSessionActionArguments: isRestoreTempoEditPayload,
    validate: (action) => {
        const target = getTempoWriteTarget({ tempoChangeId: action.payload.tempoChangeId });
        return (
            isRestoreTempoEditPayload(action.payload) &&
            target?.writable === true &&
            target.tempo === action.payload.expectedBpm &&
            tempoAudioSourcesApply(action.payload)
        );
    },
    execute: (action) => {
        if (!isRestoreTempoEditPayload(action.payload)) {
            return { status: 'conflict' };
        }
        const target = getTempoWriteTarget({ tempoChangeId: action.payload.tempoChangeId });
        if (!target?.writable || target.tempo !== action.payload.expectedBpm) {
            return { status: 'conflict' };
        }
        assertTempoWriteBpm(action.payload.bpm, target.tempoChangeId);
        if (writeTempoEdit(action.payload) === 'conflict') {
            return { status: 'conflict' };
        }
        return { status: 'written', afterCommit: markTempoProjectWrite, afterAmbiguousCommit: markTempoProjectWrite };
    },
    describe: () => ({ label: 'Restore tempo edit', inverseAction: null }),
    undoable: false,
});
