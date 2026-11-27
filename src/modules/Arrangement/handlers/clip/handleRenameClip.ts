import { createExpectedValueHandler } from '#/utils/createExpectedValueHandler';

import { renameClip } from '../../useCases/clipEditing/renameClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { readPlannedClip } from './readPlannedClip';

export const handleRenameClip = createExpectedValueHandler<'renameClip', string>({
    label: (action) => `Rename clip to "${action.payload.name}"`,
    requested: (action) => action.payload.name,
    expected: (action) => action.payload.expectedName,
    read: (action, context) => readPlannedClip(action.payload.clipId, context)?.name,
    withExpected: (action, name, expectedName) => ({
        type: 'renameClip',
        payload: { clipId: action.payload.clipId, name, expectedName },
    }),
    write: (action) => toHandlerExecutionResult(renameClip(action.payload.clipId, action.payload.name)),
});
