import { createHandler } from '#/utils/createHandler';

import { markTempoProjectWrite } from '../../useCases/markTempoProjectWrite';
import {
    capturedTempoMapReplay,
    isTempoMapEditCapture,
    isTempoMapEditNoop,
    isTempoMapEditSessionEntry,
    materializeTempoMapEdit,
    tempoMapSourcesApply,
    writeTempoMapEdit,
} from './tempoMapAudioSourceEdit';

export const handleEditTempoMap = createHandler<'editTempoMap'>({
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    canReportConflict: true,
    batchExecution: 'singleton',
    undoable: true,
    materializeCommandArgumentsAt: 'admission',
    materializeCommandArguments: materializeTempoMapEdit,
    validateSessionActionArguments: isTempoMapEditCapture,
    validateSessionEntry: isTempoMapEditSessionEntry,
    isNoop: isTempoMapEditNoop,
    validate: (action) => {
        const replay = capturedTempoMapReplay(action, 'apply');
        return replay !== null && tempoMapSourcesApply(replay.payload);
    },
    execute: (action, context) => {
        const replay = capturedTempoMapReplay(action, 'apply');
        if (!replay) {
            return { status: 'conflict' };
        }
        const result = writeTempoMapEdit(replay.payload, context);
        if (result.status === 'conflict') {
            return result;
        }
        return { ...result, afterCommit: markTempoProjectWrite, afterAmbiguousCommit: markTempoProjectWrite };
    },
    describe: (action) => ({
        label: `${action.payload.edit.type[0]!.toUpperCase()}${action.payload.edit.type.slice(1)} tempo map`,
        inverseAction: capturedTempoMapReplay(action, 'restore'),
        redoAction: capturedTempoMapReplay(action, 'apply') ?? undefined,
    }),
});
