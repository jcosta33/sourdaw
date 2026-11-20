import { type CanonicalStorageSlotMutation } from '#/infra/store/storage/applyCanonicalStorageSlotMutation';
import { type AutomergeStoragePreparationOptions } from '#/infra/store/storage/createAutomergeStorage';

export const BOUNDED_NATIVE_SEQUENCE_POLICY = 'bounded-native-sequence-v1';

/** Bound canonical re-encoding and exact float validation in each renderer task. */
export const NATIVE_SEQUENCE_MAX_OPERATIONS = 128;
export const NATIVE_SEQUENCE_MAX_BYTES = 65_536;

export type NativeMutationSequence = { readonly changeCount: number; readonly operationCount: number };

export type ProspectiveMutationWorkerRequest = {
    readonly seed: Uint8Array<ArrayBuffer>;
    readonly heads: readonly string[];
    readonly actor: string;
    readonly message?: string;
    readonly time?: number;
    readonly mutation: CanonicalStorageSlotMutation;
    readonly preparationPolicy?: AutomergeStoragePreparationOptions['preparationPolicy'];
};

export type ProspectiveMutationWorkerResult = {
    readonly changes: Uint8Array<ArrayBuffer>[];
    readonly heads: readonly string[];
    readonly sequence?: NativeMutationSequence;
};

export type ProspectiveMutationWorkerResponse =
    | ({ readonly status: 'complete' } & ProspectiveMutationWorkerResult)
    | { readonly status: 'failed'; readonly message: string };
