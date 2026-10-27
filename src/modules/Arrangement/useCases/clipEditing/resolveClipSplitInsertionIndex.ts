import { type ClipSnapshot, type ClipSplitActionSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

/** Resolve only the right fragment's slot; surviving peer clips retain their order. */
export function resolveClipSplitInsertionIndex(
    clips: readonly ClipSnapshot[],
    clipId: string,
    rightClipId: string,
    expected: ClipSplitActionSnapshot,
    replacement: ClipSplitActionSnapshot
): number | null {
    const remaining = clips.filter((clip) => clip.id !== rightClipId);
    const leftIndex = remaining.findIndex((clip) => clip.id === clipId);
    const index = replacement.rightClipIndex;
    if (!Number.isSafeInteger(index) || index <= 0 || (index > remaining.length && index !== expected.rightClipIndex)) {
        return null;
    }
    const order = replacement.rightClipOrder;
    if (!valuesEqual(order, expected.rightClipOrder)) {
        return null;
    }
    if (order === undefined || order.length === 0) {
        // An old future entry has no witnessed neighbors. Keep its original
        // conservative admission until Undo can observe the actual fragment.
        const insertion = Math.min(index, remaining.length);
        return insertion > leftIndex ? insertion : null;
    }
    const rightIndex = order.indexOf(rightClipId);
    if (
        new Set(order).size !== order.length ||
        order.some((id) => typeof id !== 'string' || id.length === 0) ||
        order.indexOf(clipId) < 0 ||
        rightIndex <= order.indexOf(clipId)
    ) {
        return null;
    }
    const livePositions = new Map(remaining.map((clip, position) => [clip.id, position]));
    const preceding = order.slice(0, rightIndex).flatMap((id) => {
        const position = livePositions.get(id);
        return position === undefined ? [] : [position];
    });
    const following = order.slice(rightIndex + 1).flatMap((id) => {
        const position = livePositions.get(id);
        return position === undefined ? [] : [position];
    });
    // Every surviving witness must still straddle the insertion. A peer that
    // reverses them creates ambiguity rather than authorizing a reordered list.
    const before = preceding.reduce((latest, position) => Math.max(latest, position), -1);
    const after = following.reduce((earliest, position) => Math.min(earliest, position), remaining.length);
    if (before >= after || before < leftIndex) {
        return null;
    }
    return following.length > 0 ? after : before + 1;
}
