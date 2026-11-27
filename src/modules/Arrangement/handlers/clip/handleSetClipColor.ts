import { createExpectedValueHandler } from '#/utils/createExpectedValueHandler';

import { setClipColor } from '../../useCases/clipEditing/setClipColor';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { readPlannedClip } from './readPlannedClip';

export const handleSetClipColor = createExpectedValueHandler<'setClipColor', string>({
    // Proven by the `canReportConflict` registry honesty spec; undo step-over (#2881) relies on it.
    canReportConflict: true,
    label: () => 'Set clip color',
    requested: (action) => action.payload.color,
    expected: (action) => action.payload.expectedColor,
    read: (action, context) => readPlannedClip(action.payload.clipId, context)?.color,
    withExpected: (action, color, expectedColor) => ({
        type: 'setClipColor',
        payload: { clipId: action.payload.clipId, color, expectedColor },
    }),
    write: (action) => toHandlerExecutionResult(setClipColor(action.payload.clipId, action.payload.color)),
});
