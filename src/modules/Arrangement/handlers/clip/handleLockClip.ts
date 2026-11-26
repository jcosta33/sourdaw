import { createExpectedValueHandler } from '#/utils/createExpectedValueHandler';

import { lockClip } from '../../useCases/clipEditing/lockClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { readPlannedClip } from './readPlannedClip';

export const handleLockClip = createExpectedValueHandler<'lockClip', boolean>({
    label: (action) => (action.payload.locked ? 'Lock clip' : 'Unlock clip'),
    requested: (action) => action.payload.locked,
    expected: (action) => action.payload.expectedLocked,
    read: (action, context) => readPlannedClip(action.payload.clipId, context)?.locked,
    withExpected: (action, locked, expectedLocked) => ({
        type: 'lockClip',
        payload: { clipId: action.payload.clipId, locked, expectedLocked },
    }),
    write: (action) => toHandlerExecutionResult(lockClip(action.payload.clipId, action.payload.locked)),
});
