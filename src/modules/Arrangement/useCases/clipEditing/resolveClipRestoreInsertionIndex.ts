import { type AppAction } from '#/utils/handlerContract';

import { isClipRestoreOrderSnapshot } from './isClipRestoreOrderSnapshot';

type ClipRestorePlacement = Pick<
    Extract<AppAction, { type: 'restoreClip' }>['payload'],
    'clipId' | 'clipIndex' | 'clipOrder'
>;

/** Insert only the removed clip; all surviving captured witnesses must keep their relative order. */
export function resolveClipRestoreInsertionIndex(
    clips: readonly { id: string }[],
    placement: ClipRestorePlacement
): number | null {
    if (!isClipRestoreOrderSnapshot(placement)) {
        return null;
    }
    const order = placement.clipOrder;
    if (order === undefined) {
        return placement.clipIndex === undefined ? clips.length : Math.min(placement.clipIndex, clips.length);
    }
    const positions = new Map<string, number>();
    for (const [index, clip] of clips.entries()) {
        if (positions.has(clip.id) || clip.id === placement.clipId) {
            return null;
        }
        positions.set(clip.id, index);
    }
    const originalIndex = order.indexOf(placement.clipId);
    let previous = -1;
    let before: number | null = null;
    let after: number | null = null;
    for (const [index, id] of order.entries()) {
        const position = positions.get(id);
        if (position === undefined) {
            continue;
        }
        if (position <= previous) {
            return null;
        }
        previous = position;
        if (index < originalIndex) {
            before = position;
        } else if (after === null) {
            after = position;
        }
    }
    if (before !== null) {
        return before + 1;
    }
    return after ?? Math.min(originalIndex, clips.length);
}
