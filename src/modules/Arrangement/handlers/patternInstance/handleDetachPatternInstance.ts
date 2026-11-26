import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { detachPatternInstance } from '../../useCases/patternInstance/detachPatternInstance';
import { getPatternInstanceLinkState } from '../../useCases/patternInstance/getPatternInstanceLinkState';
import { isPatternInstanceLinkCurrent } from '../../useCases/patternInstance/isPatternInstanceLinkCurrent';

import { isDetachPatternInstanceSessionEntry } from './isDetachPatternInstanceSessionEntry';

type DetachAction = Extract<AppAction, { type: 'detachPatternInstance' }>;
type RestoreLink = Extract<AppAction, { type: 'restorePatternInstanceLink' }>;
const capturedLinks = new WeakMap<object, RestoreLink['payload']>();

function isLinked(link: NonNullable<ReturnType<typeof getPatternInstanceLinkState>>): boolean {
    return link.state.parentClipId.present && link.state.parentClipId.value.length > 0;
}

/** The batch is a singleton, so the live link is the state this action plans against. */
function findRefusal(action: DetachAction): string | null {
    const { clipId } = action.payload;
    if (typeof clipId !== 'string' || clipId.length === 0) {
        return 'A clip ID is required';
    }
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status === 'missing') {
        return `Clip "${clipId}" does not exist`;
    }
    if (target.status !== 'eligible') {
        return `Clip "${clipId}" is on a track that cannot be edited`;
    }
    const owner = getTrackStoreState()?.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
    if (owner?.frozen === true) {
        return `Track "${owner.id}" is frozen`;
    }
    if (owner?.clips.find((clip) => clip.id === clipId)?.locked === true) {
        return `Clip "${clipId}" is locked`;
    }
    return null;
}

export const handleDetachPatternInstance = createHandler<'detachPatternInstance'>({
    batchExecution: 'singleton',
    validate: (action) => findRefusal(action) === null,
    validationRefusalReason: findRefusal,
    validateSessionEntry: isDetachPatternInstanceSessionEntry,
    // A clip that already carries no link is already detached.
    isNoop: (action) => {
        const link = getPatternInstanceLinkState(action.payload.clipId);
        return link !== null && !isLinked(link);
    },
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
        if (!captured || !isLinked(captured)) {
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
