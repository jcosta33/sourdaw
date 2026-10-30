import { isRecord } from '#/utils/structuralEquality';

/** Legacy slots remain valid; a present order must authenticate the captured index exactly. */
export function isClipRestoreOrderSnapshot(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const index = value.clipIndex;
    if (index !== undefined && (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0)) {
        return false;
    }
    if (!Object.hasOwn(value, 'clipOrder')) {
        return true;
    }
    const order = value.clipOrder;
    if (!Array.isArray(order) || typeof index !== 'number' || new Set(order).size !== order.length) {
        return false;
    }
    for (const id of order) {
        if (typeof id !== 'string' || id.length === 0) {
            return false;
        }
    }
    return order[index] === value.clipId;
}
