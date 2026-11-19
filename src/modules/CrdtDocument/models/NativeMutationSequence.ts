import { type DecodedChange } from '@automerge/automerge';

export const NATIVE_SEQUENCE_MAX_OPERATIONS = 768;
export const NATIVE_SEQUENCE_MAX_BYTES = 65_536;
/** Source authority is read in separate host tasks, without exporting the entire native history. */
export const NATIVE_SEQUENCE_HISTORY_BATCH_SIZE = 128;
export type NativeMutationSequence = { readonly changeCount: number; readonly operationCount: number };

/** Native optional authors are omitted by the decoder and nullable in metadata. */
export function isAbsentNativeAuthor(value: unknown): boolean {
    return value === undefined || value === null;
}

export function nativeChangeMessage(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    if (typeof value !== 'string') {
        throw new TypeError('Unsupported native change message');
    }
    return value;
}

function isEmptyNativeExtra(value: unknown): boolean {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** The public decoder uses extra_bytes; native history metadata uses extraBytes. */
export function hasOpaqueNativeMetadata(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return (
        ('extraBytes' in value && !isEmptyNativeExtra(value.extraBytes)) ||
        ('extra_bytes' in value && !isEmptyNativeExtra(value.extra_bytes))
    );
}

/** Only individually represented public decoded operations may cross a chunk boundary. */
export function nativeOperationCount(change: DecodedChange): number {
    const supported = new Set([
        'makeMap',
        'makeList',
        'makeText',
        'makeTable',
        'set',
        'del',
        'inc',
        'markBegin',
        'markEnd',
    ]);
    for (const op of change.ops) {
        if (!supported.has(op.action) || Object.hasOwn(op, 'multiOp') || Object.hasOwn(op, 'values')) {
            throw new Error('Unsupported packed native operation span');
        }
    }
    return change.ops.length;
}

export function isBoundedNativePreparationPolicy(value: unknown): value is 'bounded-native-sequence-v1' {
    return value === 'bounded-native-sequence-v1';
}
