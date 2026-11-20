import { isRecord } from '#/utils/structuralEquality';

import {
    NATIVE_SEQUENCE_MAX_OPERATIONS,
    type NativeMutationSequence,
} from '../models/ProspectiveMutationWorkerProtocol';

export function isNativeMutationSequence(value: unknown, changeCount: number): value is NativeMutationSequence {
    return (
        isRecord(value) &&
        Number.isSafeInteger(value.changeCount) &&
        value.changeCount === changeCount &&
        typeof value.operationCount === 'number' &&
        Number.isSafeInteger(value.operationCount) &&
        value.operationCount >= changeCount &&
        value.operationCount <= changeCount * NATIVE_SEQUENCE_MAX_OPERATIONS &&
        (changeCount > 0 || value.operationCount === 0)
    );
}
