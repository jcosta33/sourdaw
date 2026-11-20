import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type RelinkTarget, RELINK_AUDIO_SOURCE_KEYS } from '../../models/RelinkAudioSourceTarget';

function sourcesEqual(left: RelinkTarget['before'], right: RelinkTarget['before']): boolean {
    // JSON omits optional undefined fields, which still read as undefined after hydration.
    return RELINK_AUDIO_SOURCE_KEYS.every((key) => valuesEqual(left[key], right[key]));
}

function capturesEqual(left: RelinkTarget, right: RelinkTarget): boolean {
    const { before: leftBefore, after: leftAfter, ...leftOwner } = left;
    const { before: rightBefore, after: rightAfter, ...rightOwner } = right;
    return (
        valuesEqual(leftOwner, rightOwner) &&
        sourcesEqual(leftBefore, rightBefore) &&
        sourcesEqual(leftAfter, rightAfter)
    );
}

/** Authenticate paired captures without consulting the live source or owner state. */
export function isRelinkAudioSourceSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'relinkClipAudioSources' ||
        entry.inverseAction?.type !== 'relinkClipAudioSources' ||
        entry.redoAction?.type !== 'relinkClipAudioSources'
    ) {
        return false;
    }
    const forward = entry.action.payload.targets;
    const inverse = entry.inverseAction.payload.targets;
    const redo = entry.redoAction.payload.targets;
    if (forward.length === 0 || inverse.length !== forward.length || redo.length !== forward.length) {
        return false;
    }
    return forward.every((target, index) => {
        const inverseTarget = inverse[index];
        const redoTarget = redo[index];
        return (
            inverseTarget !== undefined &&
            redoTarget !== undefined &&
            capturesEqual(target, { ...inverseTarget, before: inverseTarget.after, after: inverseTarget.before }) &&
            capturesEqual(target, redoTarget)
        );
    });
}
