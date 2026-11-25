import { createExpectedValueHandler } from '#/utils/createExpectedValueHandler';

import { muteClip } from '../../useCases/clipEditing/muteClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { readPlannedClip } from './readPlannedClip';

export const handleMuteClip = createExpectedValueHandler<'muteClip', boolean>({
    label: (action) => (action.payload.muted ? 'Mute clip' : 'Unmute clip'),
    requested: (action) => action.payload.muted,
    expected: (action) => action.payload.expectedMuted,
    read: (action, context) => readPlannedClip(action.payload.clipId, context)?.muted,
    withExpected: (action, muted, expectedMuted) => ({
        type: 'muteClip',
        payload: { clipId: action.payload.clipId, muted, expectedMuted },
    }),
    write: (action) => toHandlerExecutionResult(muteClip(action.payload.clipId, action.payload.muted)),
});
