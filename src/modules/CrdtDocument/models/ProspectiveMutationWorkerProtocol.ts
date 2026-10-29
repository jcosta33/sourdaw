import { type CanonicalStorageSlotMutation } from '#/infra/store/storage/applyCanonicalStorageSlotMutation';

export type ProspectiveMutationWorkerRequest = {
    readonly seed: Uint8Array<ArrayBuffer>;
    readonly heads: readonly string[];
    readonly actor: string;
    readonly message?: string;
    readonly time?: number;
    readonly mutation: CanonicalStorageSlotMutation;
};

export type ProspectiveMutationWorkerResult = {
    readonly changes: readonly Uint8Array<ArrayBuffer>[];
    readonly heads: readonly string[];
};

export type ProspectiveMutationWorkerResponse =
    | ({ readonly status: 'complete' } & ProspectiveMutationWorkerResult)
    | { readonly status: 'failed'; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return Array.from(value).every(isJson);
    }
    return (
        isRecord(value) &&
        Object.getPrototypeOf(value) === Object.prototype &&
        Reflect.ownKeys(value).every(
            (key) =>
                typeof key === 'string' &&
                Object.prototype.propertyIsEnumerable.call(value, key) &&
                isJson(Reflect.get(value, key))
        )
    );
}

export function parseProspectiveMutationWorkerRequest(value: unknown): ProspectiveMutationWorkerRequest {
    if (
        !isRecord(value) ||
        !(value.seed instanceof Uint8Array) ||
        !(value.seed.buffer instanceof ArrayBuffer) ||
        !Array.isArray(value.heads) ||
        !value.heads.every(
            (head: unknown): head is string => typeof head === 'string' && /^[a-f0-9]{64}$/.test(head)
        ) ||
        typeof value.actor !== 'string' ||
        !/^(?:[a-f0-9]{2})+$/.test(value.actor) ||
        (value.message !== undefined && typeof value.message !== 'string') ||
        (value.time !== undefined && (typeof value.time !== 'number' || !Number.isFinite(value.time)))
    ) {
        throw new TypeError('Invalid prospective mutation Worker envelope');
    }
    const mutation = value.mutation;
    if (
        !isRecord(mutation) ||
        mutation.kind !== 'canonical-json-slot-v1' ||
        typeof mutation.key !== 'string' ||
        !isJson(mutation.baseValue) ||
        !isJson(mutation.value) ||
        (mutation.documentPresence !== undefined &&
            (!isRecord(mutation.documentPresence) ||
                (mutation.documentPresence.slot !== undefined && !isJson(mutation.documentPresence.slot))))
    ) {
        throw new TypeError('Invalid canonical storage slot description');
    }
    const documentPresence = mutation.documentPresence;
    return {
        seed: new Uint8Array(value.seed.buffer, value.seed.byteOffset, value.seed.byteLength),
        heads: value.heads,
        actor: value.actor,
        message: value.message,
        time: value.time,
        mutation: {
            kind: mutation.kind,
            key: mutation.key,
            baseValue: mutation.baseValue,
            value: mutation.value,
            documentPresence: documentPresence === undefined ? undefined : { slot: documentPresence.slot },
        },
    };
}
