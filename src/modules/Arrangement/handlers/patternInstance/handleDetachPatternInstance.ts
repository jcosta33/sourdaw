import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { detachPatternInstance } from '../../useCases/patternInstance/detachPatternInstance';
import { getPatternInstanceLinkState } from '../../useCases/patternInstance/getPatternInstanceLinkState';
import { isPatternInstanceLinkCurrent } from '../../useCases/patternInstance/isPatternInstanceLinkCurrent';

type RestoreLink = Extract<AppAction, { type: 'restorePatternInstanceLink' }>;
const capturedLinks = new WeakMap<object, RestoreLink['payload']>();

export const handleDetachPatternInstance = createHandler<'detachPatternInstance'>({
    batchExecution: 'singleton',
    execute: (alpha) => {
        const captured = capturedLinks.get(alpha);
        if (captured && !isPatternInstanceLinkCurrent({ ...captured, expected: captured.replacement })) {
            return { status: 'conflict' };
        }
        const didDetach = detachPatternInstance(alpha.payload.clipId);
        if (!didDetach) {
            return { status: 'no-write' };
        }

        return { status: 'written' };
    },
    undoable: true,
    describe: (action) => {
        capturedLinks.delete(action);
        const captured = getPatternInstanceLinkState(action.payload.clipId);
        if (!captured || !captured.state.parentClipId.present || captured.state.parentClipId.value.length === 0) {
            return { label: 'Detach Pattern Instance', inverseAction: null };
        }
        const payload: RestoreLink['payload'] = {
            clipId: action.payload.clipId,
            trackId: captured.trackId,
            expected: { parentClipId: { present: false }, overrides: { present: false } },
            replacement: captured.state,
        };
        capturedLinks.set(action, payload);
        return {
            label: 'Detach Pattern Instance',
            inverseAction: { type: 'restorePatternInstanceLink', payload },
            redoAction: {
                type: 'restorePatternInstanceLink',
                payload: { ...payload, expected: payload.replacement, replacement: payload.expected },
            },
        };
    },
});
